import { Client, DecodedMessage, Group } from "@xmtp/node-sdk";
import { isSameString, log } from "./helpers/utils.js";
import fs from 'fs/promises';
import path from 'path';

// --- Retry Logic Constants and Helper ---
const MAX_RETRIES = 6; // Max number of retry attempts
const RETRY_DELAY_MS = 10000; // Delay between retries in milliseconds (10 seconds)

// Helper function to pause execution
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to parse confession and username
function parseConfession(content: string): { confession: string; username: string } | null {
  // Find the last @ symbol in the content
  const atIndex = content.lastIndexOf('@');
  if (atIndex === -1) return null;
  
  // Get everything before the @ as the confession (including spaces)
  const confession = content.substring(0, atIndex);
  // Get everything after the @ as the username
  const username = content.slice(atIndex + 1).trim();
  
  // Validate that we have both parts
  if (!confession || !username) return null;
  
  return { confession, username };
}

// Helper function to check if there's an active game
async function hasActiveGame(): Promise<boolean> {
  try {
    const gamePath = path.join(process.cwd(), 'src', 'game.json');
    const gameData = JSON.parse(await fs.readFile(gamePath, 'utf-8'));
    
    // Check if there's any question that's not complete
    return gameData.questions.some((q: any) => !q.isComplete);
  } catch (error) {
    log(`[ERROR] Failed to check active game: ${error}`);
    return false;
  }
}

// Helper function to save confession to game.json
async function saveConfession(confession: string, username: string) {
  try {
    const gamePath = path.join(process.cwd(), 'src', 'game.json');
    const gameData = JSON.parse(await fs.readFile(gamePath, 'utf-8'));
    
    gameData.questions.push({
      question: confession,
      answer: username,
      isComplete: false,
      timestamp: new Date().toISOString()
    });
    
    await fs.writeFile(gamePath, JSON.stringify(gameData, null, 2));
    return true;
  } catch (error) {
    log(`[ERROR] Failed to save confession: ${error}`);
    return false;
  }
}

// Helper function to check guess
async function checkGuess(guess: string): Promise<{ correct: boolean; confession?: string; error?: string }> {
  try {
    const gamePath = path.join(process.cwd(), 'src', 'game.json');
    const gameData = JSON.parse(await fs.readFile(gamePath, 'utf-8'));
    
    // Get the most recent confession
    const latestConfession = gameData.questions[gameData.questions.length - 1];
    if (!latestConfession) {
      return { correct: false, error: "No game found" };
    }

    // Check if the latest confession is already complete
    if (latestConfession.isComplete) {
      return { correct: false, error: "This confession has already been guessed correctly. Wait for a new confession!" };
    }

    // Case-insensitive comparison of usernames
    const isCorrect = latestConfession.answer.toLowerCase() === guess.toLowerCase();
    
    if (isCorrect) {
      // Update isComplete to true when guessed correctly
      latestConfession.isComplete = true;
      await fs.writeFile(gamePath, JSON.stringify(gameData, null, 2));
    }
    
    return {
      correct: isCorrect,
      confession: latestConfession.question
    };
  } catch (error) {
    log(`[ERROR] Failed to check guess: ${error}`);
    return { correct: false, error: "Failed to check your guess. Please try again." };
  }
}

// --- End of Retry Logic ---

export async function listenForMessages(
  client: Client,
  groups: { announcementsGroup: Group; socialGroup: Group }
) {
  let retryCount = 0;
  const { announcementsGroup, socialGroup } = groups;

  // Outer loop for retry mechanism
  while (retryCount < MAX_RETRIES) {
    try {
      log(
        `Starting message stream... (Attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      // Initialize the stream within the try block
      const stream = await client.conversations.streamAllMessages();
      log("Message stream started successfully. Waiting for messages...");

      // Process messages from the stream
      for await (const message of stream) {
        // Simplified skip logic: only check for self and non-text initially
        if (shouldSkip(message, client)) {
          log(
            `[DEBUG] Skipping message ${message?.id}: Self-message or non-text content.`
          );
          continue;
        }

        log(`[DEBUG] Message received from: ${message?.senderInboxId}`);
        log(`[DEBUG] Client inbox ID: ${client.inboxId}`);
        log(`[DEBUG] Message content type: ${message?.contentType?.typeId}`);

        // Inner try...catch for processing individual messages
        try {
          const senderInboxId = message?.senderInboxId ?? "";
          const conversationId = message?.conversationId;

          if (!conversationId) {
            log(`[WARN] Skipping message ${message?.id}: Missing conversationId.`);
            continue;
          }

          // Get the conversation object
          const conversation = await client.conversations.getConversationById(
            conversationId
          );

          if (!conversation) {
            log(`[ERROR] Could not find conversation for message ${message?.id} with conversationId ${conversationId}`);
            continue;
          }

          // Handle /guess command
          const messageContent = message.content?.toString() || "";
          if (messageContent.startsWith('/guess')) {
            const guess = messageContent.slice('/guess'.length).trim();
            if (guess) {
              try {
                log(`[GUESS] User ${senderInboxId} guessed: ${guess}`);
                const result = await checkGuess(guess);
                
                if (result.error) {
                  await conversation.send(result.error);
                  continue;
                }
                
                if (result.correct) {
                  await conversation.send("🎉 Correct guess! You found the confessor!");
                  // Send the confession as a new message
                  await socialGroup.send(`💬 New Confession: "${result.confession}"`);
                  // Send the correct guess as a separate message
                  await socialGroup.send(`🎉 ${senderInboxId} correctly guessed who made this confession!`);
                  log(`[GUESS] User ${senderInboxId} made a correct guess!`);
                } else {
                  await conversation.send("❌ Wrong guess. Try again!");
                  // Send the confession as a new message if it hasn't been sent yet
                  await socialGroup.send(`💬 New Confession: "${result.confession}"`);
                  // Send the incorrect guess as a separate message
                  await socialGroup.send(`❌ ${senderInboxId} guessed "${guess}" - Not correct, keep trying!`);
                  log(`[GUESS] User ${senderInboxId} made an incorrect guess`);
                }
                continue;
              } catch (error) {
                log(`[ERROR] Failed to check guess: ${error}`);
                await conversation.send("Sorry, I couldn't check your guess. Please try again.");
                continue;
              }
            } else {
              await conversation.send("Please provide a username after /guess");
              continue;
            }
          }

          // Handle /confess command
          if (messageContent.startsWith('/confess')) {
            log(`[DEBUG] ===== CONFESS COMMAND START =====`);
            const content = messageContent.slice('/confess'.length).trim();
            log(`[DEBUG] Raw content: "${content}"`);
            
            // Check if there's an active game
            const activeGame = await hasActiveGame();
            if (activeGame) {
              await conversation.send("There's already an active confession game. Please wait until it's completed before starting a new one.");
              continue;
            }
            
            const parsed = parseConfession(content);
            console.log(parsed);
            log(`[DEBUG] Parsed result: ${JSON.stringify(parsed)}`);
            
            if (parsed) {
              try {
                log(`[DEBUG] Sending confession to social group`);
                await socialGroup.send(`💬 New Confession: "${parsed.confession}"`);
                
                log(`[DEBUG] Attempting to save confession`);
                const saved = await saveConfession(parsed.confession, parsed.username);
                
                if (saved) {
                  log(`[DEBUG] Confession saved successfully`);
                  await conversation.send("Confession saved successfully! Others will try to guess who made it.");
                } else {
                  log(`[DEBUG] Failed to save confession`);
                  await conversation.send("Confession was sent to the group but failed to save. Please try again.");
                }
                log(`[DEBUG] ===== CONFESS COMMAND END =====`);
                continue;
              } catch (error) {
                log(`[ERROR] Error processing confession: ${error}`);
                if (error instanceof Error) {
                  log(`[ERROR] Error stack: ${error.stack}`);
                }
                await conversation.send("Sorry, I couldn't process your confession. Please try again.");
                continue;
              }
            } else {
              log(`[DEBUG] Invalid confession format`);
              await conversation.send("Please provide your confession with your basename starting with @. Example: '/confess I like pancakes @yourname'");
              continue;
            }
          }

          // Handle /shh command
          if (messageContent.startsWith('/shh')) {
            const relayMessage = messageContent.slice(4).trim(); // Remove '/shh' and trim whitespace
            if (relayMessage) {
              try {
                await socialGroup.send(`🤫 ${relayMessage}`);
                await conversation.send("Message relayed anonymously!");
                log(`[RELAY] Anonymous message relayed to social group`);
                continue;
              } catch (error) {
                log(`[ERROR] Failed to relay message: ${error}`);
                await conversation.send("Sorry, I couldn't relay your message.");
                continue;
              }
            } else {
              await conversation.send("Please provide a message after /shh");
              continue;
            }
          }

          // Explicitly check if the conversation is a Group
          if (conversation instanceof Group) {
            log(`[DEBUG] Skipping message ${message?.id}: Is a group chat.`);
            continue; // Skip group messages
          }

          // --- Proceed only if it's confirmed to be a DM ---
          log(`[DEBUG] Message ${message?.id} is a DM. Proceeding with processing.`);

          let addedToAnnouncements = false;
          let addedToSocial = false;
          let alreadyInAnnouncements = false;
          let alreadyInSocial = false;

          // Check and add to Announcements group
          try {
            const announcementMembers = await announcementsGroup.members();
            const isMemberAnnouncements = announcementMembers.some(
              (member: { inboxId: string }) =>
                isSameString(member.inboxId, senderInboxId)
            );

            if (!isMemberAnnouncements) {
              log(
                `Adding new member ${senderInboxId} to ${announcementsGroup.name}...`
              );
              await announcementsGroup.addMembers([senderInboxId]);
              addedToAnnouncements = true;
              log(`Added ${senderInboxId} to ${announcementsGroup.name}`);
            } else {
              alreadyInAnnouncements = true;
              log(
                `User ${senderInboxId} is already a member of ${announcementsGroup.name}`
              );
            }
          } catch (e) {
            log(`[ERROR] Failed to add ${senderInboxId} to ${announcementsGroup.name}: ${e instanceof Error ? e.message : String(e)}`);
          }

          // Check and add to Social group
          try {
            const socialMembers = await socialGroup.members();
            const isMemberSocial = socialMembers.some(
              (member: { inboxId: string }) =>
                isSameString(member.inboxId, senderInboxId)
            );

            if (!isMemberSocial) {
              log(`Adding new member ${senderInboxId} to ${socialGroup.name}...`);
              await socialGroup.addMembers([senderInboxId]);
              addedToSocial = true;
              log(`Added ${senderInboxId} to ${socialGroup.name}`);
            } else {
              alreadyInSocial = true;
              log(
                `User ${senderInboxId} is already a member of ${socialGroup.name}`
              );
            }
          } catch (e) {
            log(`[ERROR] Failed to add ${senderInboxId} to ${socialGroup.name}: ${e instanceof Error ? e.message : String(e)}`);
          }

          // Send confirmation message
          let confirmationMessage = "";
          if (addedToAnnouncements && addedToSocial) {
            confirmationMessage = `You've been added to the "${announcementsGroup.name}" and "${socialGroup.name}" groups. You'll see the chat in your requests when a new message is sent!`;
          } else if (addedToAnnouncements && alreadyInSocial) {
            confirmationMessage = `You've been added to the "${announcementsGroup.name}" group. You were already in the "${socialGroup.name}" group.`;
          } else if (addedToSocial && alreadyInAnnouncements) {
            confirmationMessage = `You've been added to the "${socialGroup.name}" group. You were already in the "${announcementsGroup.name}" group.`;
          } else if (addedToAnnouncements) { // Only added to announcements, implies not in social before and successfully added
            confirmationMessage = `You've been added to the "${announcementsGroup.name}" group. We tried to add you to "${socialGroup.name}" as well.`;
          } else if (addedToSocial) { // Only added to social, implies not in announcements before and successfully added
            confirmationMessage = `You've been added to the "${socialGroup.name}" group. We tried to add you to "${announcementsGroup.name}" as well.`;
          } else if (alreadyInAnnouncements && alreadyInSocial) {
            confirmationMessage = `You're already a member of both the "${announcementsGroup.name}" and "${socialGroup.name}" groups!`;
          } else {
            // Fallback for other combinations (e.g., already in one, failed to add to other)
            let messageParts = [];
            if (addedToAnnouncements) messageParts.push(`added to "${announcementsGroup.name}"`);
            else if (alreadyInAnnouncements) messageParts.push(`already in "${announcementsGroup.name}"`);

            if (addedToSocial) messageParts.push(`added to "${socialGroup.name}"`);
            else if (alreadyInSocial) messageParts.push(`already in "${socialGroup.name}"`);

            if (messageParts.length > 0) {
              confirmationMessage = `Your status: ${messageParts.join(' and ')}. Check your message requests.`;
            } else {
               confirmationMessage = "Your group membership status has been processed. Check your message requests.";
            }
          }

          if (confirmationMessage) {
               await conversation.send(confirmationMessage);
          }

        } catch (processingError: unknown) {
          // Log errors processing individual messages but continue the stream
          const errorMessage =
            processingError instanceof Error ? processingError.message : String(processingError);
          log(`Error processing message ${message?.id}: ${errorMessage}`);

          // Attempt to send error reply
          try {
            const convIdForError = message?.conversationId;
            if (convIdForError) {
               const errorConversation = await client.conversations.getConversationById(convIdForError);
               // Check if it's not a group before sending error
               if (errorConversation && !(errorConversation instanceof Group)) {
                  await errorConversation.send(
                    "Sorry, I encountered an error processing your message."
                  );
               }
            }
          } catch (sendError) {
            log(
              `Failed to send error message after processing error: ${
                sendError instanceof Error ? sendError.message : String(sendError)
              }`
            );
          }
        } // End of inner try...catch for message processing
      } // End of for await...of stream loop

      // If the stream completes without error (less common for indefinite streams), reset retry count
      log("Message stream completed normally.");
      retryCount = 0; // Reset retries if stream finishes cleanly

    } catch (streamError: unknown) {
      // Handle errors related to the stream itself (initialization or fatal error)
      retryCount++;
      log(`Stream error (Attempt ${retryCount}/${MAX_RETRIES}): ${streamError instanceof Error ? streamError.message : String(streamError)}`);
      if (streamError instanceof Error && streamError.stack) {
          log(`Stack trace: ${streamError.stack}`);
      }

      if (retryCount < MAX_RETRIES) {
        log(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retrying stream...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        log("Maximum retry attempts reached for message stream. Exiting listener.");
        // The while loop condition will handle exiting
      }
    } // End of outer try...catch for stream handling
  } // End of while loop for retries

  log("listenForMessages function finished."); // Indicates the retry loop has exited
}

// Updated shouldSkip: Only checks self-message and content type
function shouldSkip(
  message: DecodedMessage<any> | undefined,
  client: Client
) {
  if (!message) {
    return true;
  }
  return (
    isSameString(message.senderInboxId, client.inboxId) ||
    message.contentType?.typeId !== "text"
  );
} 
