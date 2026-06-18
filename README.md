# P2P WebShare

A lightning-fast, and hyper-secure peer-to-peer file sharing web application. 
Send files directly from your browser to anyone in the world without them ever touching a server. Built with WebRTC and end-to-end encrypted using AES-256-GCM.

Live demo : click here to try the app : https://p2-p-webshare-2-0.vercel.app/

## Key Features

-  Direct Peer-to-Peer: Files are transferred directly between browsers using WebRTC Data Channels. No intermediate servers means blazing fast transfer speeds.
-  End-to-End Encryption (E2EE): Every file chunk is encrypted in the browser using AES-GCM 256-bit encryption before it even touches the network.
-  Zero-Knowledge Architecture: The encryption key is randomly generated and appended to the sharing URL as a hash (`#key=...`). The signaling server never sees the key, meaning no one can decrypt your files in transit.
-  Unlimited File Size: Uses chunking and the Origin Private File System (OPFS) API to stream files directly to disk, completely bypassing browser RAM limits. Send multi-gigabyte files effortlessly.
-  Integrity Verification: The sender automatically calculates a SHA-256 hash of the original file. The receiver re-calculates the hash upon completion to guarantee mathematical file integrity.

##  Tech Stack

- **Frontend:** React, Vite, TailwindCSS (for pure styling), Web Crypto API, WebRTC
- **Backend (Signaling only):** Node.js, Express, Socket.io
- **Design:** Custom modern glassmorphism UI with responsive CSS animations.

##  How to Run Locally

Because the project relies on WebRTC to connect peers, it uses a lightweight Node.js signaling server to help the browsers find each other. You need to run both the Client and the Server.

### 1. Start the Signaling Server
Open a terminal and navigate to the `server` directory:
```bash
cd server
npm install
npm run start
```
The server will start on `http://localhost:3001`.

### 2. Start the Frontend Client
Open a **second** terminal and navigate to the `client` directory:
```bash
cd client
npm install
npm run dev
```
The frontend will start on `http://localhost:5173`.

### 3. Test it out!
1. Open `http://localhost:5173` in your browser.
2. Drag and drop a file into the upload zone.
3. Copy the generated link.
4. Open a new tab (or send the link to another device on the same network) and paste the link.
5. Watch the secure transfer happen in real-time!

##  How it Works (Under the Hood)
1. **Selection:** Sender selects a file.
2. **Key Generation:** Web Crypto API generates a random AES key.
3. **Signaling:** Sender creates a room on the Socket.io signaling server.
4. **Link Sharing:** Sender shares the link containing the Room ID and the AES Key (in the URL hash).
5. **Connection:** Receiver joins the room. Browsers negotiate a WebRTC connection.
6. **Streaming:** File is read in 16KB chunks, encrypted, and streamed over the WebRTC DataChannel.
7. **Reassembly:** Receiver decrypts chunks in real-time, stores them via OPFS, and auto-downloads the completed file after verifying the SHA-256 hash.

