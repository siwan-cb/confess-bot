import { Client, IdentifierKind, type Group, DecodedMessage, GroupPermissionsOptions } from "@xmtp/node-sdk";
import { log, isSameString } from "./helpers/utils.js";
import { Signer } from "ethers";

const BASE_SUMMIT_ADMIN_ADDRESS = "0x80245b9C0d2Ef322F2554922cA86Cf211a24047F"; // Admin address for Base Summit groups

const ANNOUNCEMENTS_GROUP_NAME = "📣 Announcements";
const SOCIAL_GROUP_NAME = "🎉 Social";

// Helper to find a group by its name
const findGroupByName = async (client: Client, groupName: string): Promise<Group | undefined> => {
  log(`[INFO] Looking for existing group: "${groupName}"...`);
  // Assuming client.conversations.sync() is called before this if needed,
  // or within the calling function like findOrCreateGroupByNameInternal.
  const conversations = await client.conversations.list();
  return conversations.find((g) => (g as Group).name === groupName) as Group | undefined;
};

// Helper to add a designated admin to a group
const addAdminToGroupInternal = async (group: Group, adminAddress: string) => {
  if (!adminAddress) {
    log(`[ERROR] Admin address is not set for group "${group.name}"`);
    return;
  }

  log(`[INFO] Adding admin ${adminAddress} to group "${group.name}"...`);

  // Check if admin is already a member, otherwise add them
  const members = await group.members();
  let adminMember = members.find(m =>
    m.accountIdentifiers.some(
      id => id.identifierKind === IdentifierKind.Ethereum && isSameString(id.identifier, adminAddress)
    )
  );

  if (!adminMember) {
    try {
      await group.addMembersByIdentifiers([
        {
          identifier: adminAddress,
          identifierKind: IdentifierKind.Ethereum,
        },
      ]);
      // Re-fetch members to get the inboxId of the newly added admin
      const updatedMembers = await group.members();
      adminMember = updatedMembers.find(m =>
        m.accountIdentifiers.some(
          id => id.identifierKind === IdentifierKind.Ethereum && isSameString(id.identifier, adminAddress)
        )
      );
    } catch (e) {
      log(`[ERROR] Failed to add admin ${adminAddress} as member to group "${group.name}": ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }

  if (adminMember) {
    // Check if admin is already a super admin
    const superAdmins = group.superAdmins; // Corrected: Access as a property
    if (superAdmins.includes(adminMember.inboxId)) {
      log(`[INFO] ${adminAddress} is already a super admin in group "${group.name}"`);
    } else {
      try {
        await group.addSuperAdmin(adminMember.inboxId);
        log(`[SUCCESS] Added ${adminAddress} as super admin to group "${group.name}"`);
      } catch (e) {
         log(`[ERROR] Failed to promote ${adminAddress} to super admin in group "${group.name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    log(
      `[WARNING] Could not find or add member ${adminAddress} to promote as admin in group "${group.name}"`
    );
  }
};

// Internal function to find or create a specific group by name
async function findOrCreateGroupByNameInternal(
  client: Client,
  groupName: string,
  groupDescription: string,
  adminAddress: string
): Promise<Group> {
  await client.conversations.sync(); // Sync before listing/creating

  let group = await findGroupByName(client, groupName);
  if (group) {
    log(`[INFO] Found existing group: "${groupName}" (ID: ${group.id})`);
    // Ensure admin is set even for existing groups
    await addAdminToGroupInternal(group, adminAddress);
    return group;
  }

  log(`[INFO] Creating new group: "${groupName}"...`);
  const newGroup = await client.conversations.newGroup([], {
    groupName: groupName,
    groupDescription: groupDescription,
  });

  log(`[SUCCESS] Group "${groupName}" created successfully (ID: ${newGroup.id}). Adding admin...`);
  await addAdminToGroupInternal(newGroup, adminAddress);
  return newGroup;
}

// Exported function to find or create both Base Summit groups
export async function findOrCreateBaseSummitGroups(client: Client): Promise<{
  announcementsGroup: Group;
  socialGroup: Group;
}> {
  log(`[INFO] Finding or creating Base Summit groups...`);

  const announcementsGroup = await findOrCreateGroupByNameInternal(
    client,
    ANNOUNCEMENTS_GROUP_NAME,
    "Announcements for Base Summit 2025",
    BASE_SUMMIT_ADMIN_ADDRESS
  );

  const socialGroup = await findOrCreateGroupByNameInternal(
    client,
    SOCIAL_GROUP_NAME,
    "Social chat for Base Summit 2025 attendees",
    BASE_SUMMIT_ADMIN_ADDRESS
  );

  log(`[INFO] Base Summit groups processed.`);
  return { announcementsGroup, socialGroup };
} 
