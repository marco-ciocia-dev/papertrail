<div align="center">
  <h1>📄 PaperTrail</h1>
  <p><strong>AI-powered expense report tool — photograph a receipt, get structured data instantly</strong></p>
  <p>
    <img alt="Status" src="https://img.shields.io/badge/status-production-brightgreen?style=flat-square">
    <img alt="Stack" src="https://img.shields.io/badge/stack-React%20%7C%20Claude%20Vision%20%7C%20Vercel-blue?style=flat-square">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square">
  </p>
</div>

---

> **Note:** This is a bespoke tool commissioned by and built exclusively for a specific company. It is not a general-purpose SaaS product — it is tailored to that company's exact workflow and is currently in daily production use. A generalized, multi-tenant version is planned for future development.

## What is PaperTrail?

PaperTrail is an AI expense management tool built for a construction company to eliminate the manual process of compiling annual expense reports from receipts.

Previously, business partners had to manually transcribe data from dozens of paper receipts into an Excel spreadsheet at the end of the year — date, vendor, amount, fiscal number, one by one. PaperTrail replaces that entirely.

They photograph the receipts → Claude Vision API extracts all structured data automatically → one-click export to a formatted Excel file ready for the accountant.

## How it works

```
Partner photographs receipt (mobile or desktop)
        ↓
Claude Vision API extracts structured data
(date, vendor, amount, fiscal number)
        ↓
Human review & confirmation screen
        ↓
Expense saved to session log
        ↓
Export → formatted Excel (one click)
```

## Features

- **AI receipt scanning** — Claude Vision extracts date, vendor, amount, and fiscal number from any receipt photo
- **Human-in-the-loop review** — extracted data is shown for confirmation before saving
- **Session-based expense log** — accumulate multiple receipts in a single session
- **One-click Excel export** — formatted output via ExcelJS, ready for accounting
- **Secure API proxy** — API key never exposed to the client; routed through a serverless Vercel function
- **Password-protected access** — single-company deployment, access restricted

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite |
| AI | Claude Vision API (Anthropic) |
| Export | ExcelJS |
| Backend | Node.js serverless (Vercel Functions) |
| Deploy | Vercel |

## Local Development

```bash
# Clone the repo
git clone https://github.com/marco-ciocia-dev/papertrail.git
cd papertrail

# Install dependencies
npm install

# Add your Anthropic API key
echo "VITE_ANTHROPIC_API_KEY=your_key_here" > .env.local

# Start dev server
npm run dev
```

## Project Structure

```
papertrail/
├── api/
│   └── proxy.js          # Serverless API proxy (keeps API key server-side)
├── src/
│   └── App.jsx           # Main application component
├── public/
├── vercel.json           # Vercel routing config
└── vite.config.js
```

## Roadmap

The current version is a single-company deployment. Planned future development:

- Multi-company / multi-user authentication
- Per-user expense tracking and assignment
- PDF export alongside Excel
- Cloud storage for receipt images
- Category tagging and budget tracking

---

**Built by [Marco Ciocia](https://github.com/marco-ciocia-dev) · AI Product Developer & Vibe Coder**
