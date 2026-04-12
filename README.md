<div align="center">
  <h1>📄 PaperTrail</h1>
  <p><strong>AI-powered expense management — photograph a receipt, get structured data instantly</strong></p>
  <p>
    <img alt="Status" src="https://img.shields.io/badge/status-production-brightgreen?style=flat-square">
    <img alt="Stack" src="https://img.shields.io/badge/stack-React%20%7C%20Claude%20Vision%20%7C%20Vercel-blue?style=flat-square">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square">
  </p>
</div>

---

## What is PaperTrail?

PaperTrail is an AI expense management tool commissioned by and **in daily use at a real company**.

Employees photograph receipts on mobile → Claude Vision API extracts structured data automatically (date, vendor, amount, fiscal number) → one-click export to formatted Excel and PDF.

No more manual data entry. No more lost receipts.

## Features

- **AI receipt scanning** — Claude Vision extracts date, vendor, amount, fiscal number from any photo
- **Human-in-the-loop review** — verify extracted data before confirming
- **Per-employee assignment** — track expenses by team member
- **One-click export** — formatted Excel (ExcelJS) and PDF output
- **Mobile-first** — designed for photographing receipts in the field
- **Secure deployment** — serverless API proxy on Vercel, password-protected access

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite |
| AI | Claude Vision API (Anthropic) |
| Export | ExcelJS |
| Backend | Node.js serverless (Vercel) |
| Deploy | Vercel |

## How it works

```
Employee photographs receipt (mobile)
        ↓
Claude Vision API extracts structured data
        ↓
Human review & confirmation screen
        ↓
Assigned to employee, saved to session
        ↓
Export → Excel / PDF (one click)
```

## Local Development

```bash
# Clone the repo
git clone https://github.com/marco-ciocia-dev/papertrail.git
cd papertrail

# Install dependencies
npm install

# Add your API key
echo "VITE_ANTHROPIC_API_KEY=your_key_here" > .env.local

# Start dev server
npm run dev
```

## Project Structure

```
papertrail/
├── api/
│   └── proxy.js          # Serverless API proxy (hides API key)
├── src/
│   ├── App.jsx           # Main application component
│   └── ...
├── public/
├── vercel.json           # Vercel routing config
└── vite.config.js
```

## Context

Built as a freelance commission for a construction company to replace their manual expense tracking process. The core insight: workers on job sites don't have time for spreadsheets — they need to photograph and move on.

---

**Built by [Marco Ciocia](https://github.com/marco-ciocia-dev) · AI Product Developer & Vibe Coder**
