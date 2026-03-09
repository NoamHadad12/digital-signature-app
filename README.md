# SignFlow: Digital PDF Signing Application

SignFlow is a modern, web-based application that simplifies the process of signing PDF documents. Users can upload a PDF, generate a unique and secure link, and share it with others to collect digital signatures. The application intelligently places the signature on the document and provides a downloadable, signed copy.

 <!-- It's recommended to add a GIF or screenshot of your app here -->

## ✨ Features

-   **PDF Upload**: Easily upload any PDF document from your local machine.
-   **Shareable Links**: Automatically generates a unique URL for each document, making it easy to share for signing.
-   **Digital Signature Pad**: An intuitive canvas for drawing a smooth and natural-looking signature.
-   **Intelligent Signature Placement**: The backend service scans the document for keywords like "Signature" or "Sign Here" to automatically place the signature in the correct location.
-   **Secure Cloud Storage**: All documents (original and signed) are securely stored using Firebase Cloud Storage.
-   **Download Signed Documents**: Once signed, a download link for the completed PDF is provided.
-   **Responsive Design**: A clean and functional interface that works on various devices.

## 🚀 Technologies Used

-   **Frontend**:
    -   [React](https://reactjs.org/)
    -   [Vite](https://vitejs.dev/)
    -   [React Router](https://reactrouter.com/) for client-side routing.
    -   [React-PDF](https://github.com/wojtekmaj/react-pdf) for rendering PDFs in the browser.
    -   [React Signature Canvas](https://github.com/agilgur5/react-signature-canvas) for the signature pad.
-   **Backend (Serverless)**:
    -   [Vercel Serverless Functions](https://vercel.com/docs/functions)
    -   [Node.js](https://nodejs.org/)
-   **Services & Libraries**:
    -   [Firebase Cloud Storage](https://firebase.google.com/docs/storage) for file storage.
    -   [pdf-lib](https://pdf-lib.js.org/) for embedding signatures into PDF documents on the server.
    -   [pdfjs-dist](https://mozilla.github.io/pdf.js/) for parsing PDF text content to find signature locations.
    -   [UUID](https://github.com/uuidjs/uuid) for generating unique document IDs.

## ⚙️ Installation & Setup

Follow these steps to get the project running on your local machine.

**1. Clone the Repository**

```bash
git clone https://github.com/your-username/digital-signature-app.git
cd digital-signature-app
```

**2. Install Dependencies**

Install the required npm packages for both the frontend and backend.

```bash
npm install
```

**3. Set Up Environment Variables**

You will need a Firebase project to handle storage.

-   Create a new project on the [Firebase Console](https://console.firebase.google.com/).
-   Go to Project Settings > Service accounts to get your project configuration.
-   Enable Cloud Storage in your Firebase project.

Create a `.env.local` file in the root of the project and add your Firebase configuration keys. This file is included in `.gitignore` and should not be committed to version control.

```env
# .env.local

# Firebase Variables for the Frontend (Vite)
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Gemini Field Detection
VITE_GEMINI_API_KEY=AIza...
```

**4. Run the Development Server**

This command starts the Vite development server for the React frontend and makes the Vercel serverless function available for local development.

```bash
npm run dev
```

The application will be available at `http://localhost:5173` (or another port if 5173 is in use). The serverless API will be proxied from `/api`.

## 📖 Usage

1.  **Upload a PDF**:
    -   Navigate to the home page.
    -   Click the "Choose File" button and select a PDF document.
    -   Click "Upload & Generate Link".

2.  **Share the Link**:
    -   A unique link for the document will be displayed.
    -   Copy the link and share it with the person who needs to sign.

3.  **Sign the Document**:
    -   Opening the link will load the `SignerView`, displaying the PDF.
    -   Use the signature pad at the bottom to draw a signature.
    -   Click "Complete & Sign".

4.  **Download**:
    -   The signature is embedded into the PDF, and a new signed version is created.
    -   A success screen appears with a button to download the final document.



    # 1. Switch to the main branch
git checkout main

# 2. Pull the latest changes from the remote main to stay updated
git pull origin main

# 3. Merge the dev branch into main
git merge dev

# 4. Push the merged changes to the remote repository (this triggers Vercel deployment)
git push origin main

# 5. Optional: Switch back to dev to continue working on new features
git checkout dev
