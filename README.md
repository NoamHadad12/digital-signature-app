# SignFlow

SignFlow is a modern digital document management and signing platform. It streamlines the document workflow by using AI-powered field detection to automatically identify where signatures, dates, and text input are required.

## 🚀 Key Features

- **Digital Signatures:** Securely sign PDF documents with custom signature inputs.
- **AI Field Detection:** Powered by **Gemini 2.5 Flash**, the system automatically analyzes PDFs to suggest form field placements.
- **Admin Dashboard:** Manage users, track document statuses (Pending, Signed), and view recent activity.
- **Real-time Updates:** Integrated with **Firebase Firestore** for instant document state tracking.
- **Secure Storage:** Documents are safely stored in **Firebase Storage**.

## 🛠 Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, Lucide React
- **Backend:** Vercel Serverless Functions (Node.js)
- **Database & Storage:** Firebase (Firestore & Storage)
- **AI Engine:** Google Gemini AI API
- **PDF Manipulation:** `pdf-lib`, `react-pdf`
- **Hosting:** Vercel

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Vercel CLI](https://vercel.com/docs/cli) (Installed globally via `npm i -g vercel`)
- A Firebase Project (with Firestore and Storage enabled)
- A Google AI Studio API Key (for Gemini)

## ⚙️ Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd signflow
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory (or `.env.local`) and add your credentials:
   ```env
   # Firebase Configuration
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id

   # Gemini AI Configuration
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```

## 💻 Running Locally

To run the application with both the Vite frontend and the Vercel Serverless backend functions, use the following command:

```bash
npm run dev
```

> **Note:** We use `vercel dev` as the main development command in `package.json`. This ensures that the `/api` routes are correctly served alongside the frontend, avoiding `ECONNREFUSED` or `502 Bad Gateway` errors during local development. By default, `vercel dev` will detect the Vite project and start both the frontend (usually on port 5173 or similar) and the serverless functions (usually on port 3000).

If you are running this for the first time, you might need to link your project to Vercel:
```bash
vercel link
```

## 🏗 Project Structure

- `api/`: Vercel Serverless Functions (Backend logic, e.g., PDF analysis).
- `src/components/`: Reusable UI components and page views.
- `src/hooks/`: Custom React hooks for business logic.
- `src/services/`: Database and AI service integrations.
- `src/utils/`: Helper functions for PDF handling and logging.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.


git add .
git commit -m "fix problem"
git checkout main
git merge dev
git push origin main