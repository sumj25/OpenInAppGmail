import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { scheduleJob } from "node-schedule";
import process from "process";
import path from "path";
import { promises } from "fs";


const main = async () => {
  // Define the Gmail API scopes for the application
  const SCOPES = [
    "https://mail.google.com/", // Access to read and manage email
    "https://www.googleapis.com/auth/gmail.modify", // Access to modify Gmail messages
    "https://www.googleapis.com/auth/gmail.compose", // Access to compose new Gmail messages
    "https://www.googleapis.com/auth/gmail.send", // Access to send Gmail messages
    "https://www.googleapis.com/auth/gmail.labels", // Access to manage Gmail labels
  ];

  // File paths for token and credentials
  const TOKEN = path.join(process.cwd(), "token.json");
  const CREDENTIALS = path.join(process.cwd(), "credentials.json");

  // Function to load previously saved credentials if they exist
  async function loadSavedCredentialsIfExist() {
    try {
      const content = await promises.readFile(TOKEN);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  // Function to save credentials to a file
  async function saveCredentials(client) {
    const content = await promises.readFile(CREDENTIALS);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await promises.writeFile(TOKEN, payload);
  }

  // Function to authorize and obtain access to the Gmail API
  async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
  }

  // Function to list labels in the user's Gmail account
  async function listAllLabels(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.labels.list({
      userId: "me",
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
      console.log("No labels found.");
      return;
    }
    // labels.forEach((label) => {
    //   console.log(`- ${label.id}`);
    // });
  }

  // Function to send a reply email as a response to the specified thread
  async function replyMessage(auth, threadId) {
    const gmail = google.gmail({ version: "v1", auth });
    const message = "This is an auto-generated reply.";
    const header = await gmail.users.messages.get({
      userId: "me",
      id: threadId,
    });
    const from = header.data.payload.headers.find(
      (header) => header.name === "From"
    ).value;
    const to = header.data.payload.headers.find(
      (header) => header.name === "To"
    ).value;
    console.log(from, to);

    // Send the reply email
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId: threadId,
        raw: generateRawMessage(to, from, message),
      },
    });
    console.log("Successfully responded to the email.");

    // Modify the thread and apply labels
    await gmail.users.messages.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: ["Label_7563311595039107493"], // Add a specific label to the email thread
        removeLabelIds: ["UNREAD"], // Remove the "UNREAD" label
        markasread: true, // Mark the email as read
      },
    });

    await listAllLabels(auth); // List all labels after modifying the thread
    console.log("Successfully assigned a label to the email.");
  }

  // Function to generate the raw message content for sending an email
  const generateRawMessage = (to, from, message1) => {
    const subject = "On Parental Leave";
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const messageParts = [
      `From: Suman Kumar <${to}>`,
      `To: ${from}`,
      "Content-Type: text/html; charset=utf-8",
      "MIME-Version: 1.0",
      `Subject: ${utf8Subject}`,
      "",
      "Dear Sender, Thank you for reaching out. Currently, I'm on parental leave and will contact you as soon as possible. Meanwhile, if it is urgent, you can call me at 8292290456.",
    ];
    const message = messageParts.join("\n");

    // Encode the message body to base64url format
    const encodedMessage = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return encodedMessage;
  }

  // Function to send a reply email to the sender of the specified thread (Unreplied)
  async function sendReplyEmailToUnReplied(auth, threadId) {
    await replyMessage(auth, threadId);
  }

  // Function to fetch unread messages from threads and send replies
  async function fetchUnreadMessagesFromThreads(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.threads.list({
      userId: "me",
      q: "in:inbox is:unread label:UNREAD", // Search for unread threads with the "UNREAD" label
    });
    const threads = res.data.threads;
    if (!threads || threads.length === 0) {
      console.log("No unread messages found.");
      return;
    }
    sendReplyEmailToUnReplied(auth, threads[0].id); // Send a reply email to the first unread thread
  }

  // Authorize the app and schedule checking for new emails
  authorize().then((auth) => {
    const random = Math.floor(Math.random() * 120) + 45;
    scheduleJob(`*/${random} * * * * *`, () => {
      console.log("Checking for new emails in the Inbox...");
      fetchUnreadMessagesFromThreads(auth);
    });
  });
};

// Run the main email bot
main().catch(console.error);
