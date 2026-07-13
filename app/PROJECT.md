# GameHeelTigerNeerRines HQ

## Vision

GameHeelTigerNeerRines HQ is a web application that manages an annual college football draft league.

The application should feel modern, fast, and fun while removing as much commissioner work as possible.

Long-term vision:

- AI Commissioner
- Automated standings
- Weekly recaps
- Owner dashboards
- Draft room
- Mobile friendly
- Text message notifications

---

# MVP Goals

A commissioner can:

- Create a league
- Invite owners
- Draft teams
- Enter weekly scores
- View standings

An owner can:

- Join a league
- Draft teams
- View standings
- View schedule
- Receive updates

---

# Tech Stack

- Next.js
- React
- TypeScript
- Supabase
- Tailwind CSS

---

# Architecture

Pages

- src/app

Reusable Components

- src/components/ui

Commissioner Components

- src/components/commissioner

Services

- src/services

Types

- src/types

Supabase Client

- src/lib

---

# UI Philosophy

Every reusable UI element should live inside:

src/components/ui

Examples:

- Button
- Card
- Input
- Select

Pages should assemble components.

Components should never contain database logic.

---

# Data Philosophy

UI

↓

Services

↓

Supabase

Never access Supabase directly from UI components.

---

# Current Progress

✅ Environment setup

✅ GitHub

✅ Next.js

✅ Supabase

✅ Commissioner Dashboard

✅ League Setup Wizard

✅ Create League

⬜ Dashboard reads live data

⬜ Owner invitations

⬜ Draft

⬜ Weekly scoring

⬜ Standings

⬜ AI Commissioner

---

# Coding Standards

Small components.

One responsibility per component.

One responsibility per service function.

Commit after every completed feature.

Never leave main in a broken state.

---

# Sprint Workflow

1. Pick one feature.

2. Build only that feature.

3. Test it.

4. Commit.

5. Push.

6. Celebrate.

---

# Current Sprint

Replace dashboard placeholder data with live league data from Supabase.