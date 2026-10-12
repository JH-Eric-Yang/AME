<p align="center">
  <a href="https://ameexp.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
      <img src="docs/assets/logo.svg" alt="AME logo" width="112">
    </picture>
  </a>
</p>

<h1 align="center">AME — Autonomous Multimodal Experiment</h1>

<p align="center">
  Video-chat experiments that run without an experimenter.
</p>

<p align="center">
  <a href="https://ameexp.com"><b>Website</b></a> ·
  <a href="https://ameexp.com/docs"><b>Documentation</b></a> ·
  <a href="https://ameexp.com/admin/login"><b>Admin dashboard</b></a>
</p>

AME (say "a-meh") is a web platform for behavioural science. You use it to
design, run and manage online experiments that collect multimodal data:
video, audio, body movement, speech and responses.

AME runs an experiment without an experimenter in the session. The server
matches participants into video calls, gives each participant their content,
checks their position on the camera, and stores their data.

> **Status:** This repository is in preparation. The source code will come
> here soon. This README describes the platform that we will release.

## Contents

- [Use the hosted version](#use-the-hosted-version)
- [Why AME](#why-ame)
- [Features](#features)
- [How an experiment is built](#how-an-experiment-is-built)
- [Elements](#elements)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Install and run](#install-and-run)
- [Configuration](#configuration)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Authors](#authors)
- [Citation](#citation)
- [License](#license)

## Use the hosted version

We run AME at **[ameexp.com](https://ameexp.com)**. You do not need to install
anything to use it.

1. Go to [ameexp.com/admin/login](https://ameexp.com/admin/login).
2. Create an account. An administrator reviews your request.
3. After approval, log in and build your experiment in the dashboard.
4. Send the experiment link to your participants.

The [documentation](https://ameexp.com/docs) on the website explains each
progress, routine and element.

To run AME on your own server, see [Install and run](#install-and-run).

## Why AME

Most online experiment tools show stimuli and collect clicks. Studies of
face-to-face interaction need more. They need live video between
participants, audio-visual recordings and control of who meets whom.

Usually, an experimenter must join each session to do these tasks. AME does
these tasks automatically:

- The server puts participants into video calls by rules that you set.
- Browser models detect the face, the hands and the body. They check that a
  participant sits correctly before the recording starts.
- A phone can join as a second camera or as a controller. The participant
  scans a QR code to connect it.
- The server sends each step of the experiment over a WebSocket and keeps the
  state of each participant.

## Features

- **Visual builder.** Put elements on a canvas, set their parameters and see
  the result immediately.
- **Conditions and randomization.** Give each condition its own sequence of
  steps. Shuffle ranges of trials.
- **Participant matching.** Each video-chat routine has its own matching
  rule:
  - **FIFO** — the server groups participants in the order that they arrive.
  - **Condition-aware** — the server groups participants from different
    conditions, for example one from group A and one from group B.
  - **Manual** — the experimenter assigns the groups in the dashboard.
- **Video chat.** Native WebRTC with Socket.IO signalling. A TURN relay is
  supported for networks that block a direct connection.
- **Recording.** Audio and video come from the webcam. The browser uploads
  them in resumable chunks (tus protocol), so a slow network does not lose a
  recording.
- **Supplementary device.** A phone streams its camera to the desktop or acts
  as a controller.
- **References.** A later step can use an earlier response, for example
  replay a participant's own recording or show their typed answer.
- **Resume.** A participant who loses the connection continues from the same
  step. External IDs (for example `PROLIFIC_PID`) let a participant continue
  in a different browser.
- **Results.** Export responses as CSV and media files as a ZIP archive.
- **Accounts.** An administrator approves each new experimenter account.

## How an experiment is built

AME uses four levels:

```
Experiment → Progress → Routine → Element
```

| Level | What it does |
|---|---|
| **Experiment** | Holds the global parameters: AV recording, body detection, video chat, supplementary device, active time, roll-back time, participants per session, randomization and conditions. |
| **Progress** | One step in the sequence. Progress is the unit of randomization. |
| **Routine** | The layout of a step. A routine holds one or more element sets. In a group session, each participant sees only their own set. |
| **Element** | The smallest part. An element shows a stimulus, collects data or monitors the participant. |

Predefined routines:

- **Layout:** `routine-borderless`, `routine-card`
- **Function:** `routine-consent`, `routine-end`, `routine-pos-check`,
  `routine-matching`, `routine-video-chat`, `routine-end-matching`,
  `routine-survey`

Elements send four types of events:

1. **Data** — keeps a value in the browser until the next Proceed event.
2. **Proceed** — ends the routine, uploads the data and goes to the next step.
3. **Complete** — ends the experiment and records completion or withdrawal.
4. **Alert** — pauses the experiment with a message and records the alert.

## Elements

| Family | Elements |
|---|---|
| **Stimulus** | text, image, video, audio, video-chat |
| **Response** | recorder, keyboard, button, input-textfield, input-select, input-option-group, input-slider, input-file-picker, survey |
| **Monitor** | body-detector, facial-expression-detector, speech-recognizer, volume-check, timer |

Body, hand and face detection use
[MediaPipe](https://developers.google.com/mediapipe) in the browser. No video
goes to a server for detection.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | SvelteKit, Svelte 5, TypeScript |
| Backend | Express, TypeScript |
| Database | PostgreSQL with Prisma |
| Cache | Redis (waiting rooms and the Socket.IO adapter) |
| Realtime | Socket.IO |
| Video | Native WebRTC |
| Upload | tus (resumable chunked upload) |
| Authentication | JWT and bcrypt |
| Production | PM2 |

One Express process serves the REST API, Socket.IO and the tus uploads.

## Requirements

- Node.js 20.6 or later
- PostgreSQL
- Redis
- A browser with WebRTC support. We recommend a recent version of Chrome.
- For production: HTTPS. Browsers give camera access only on a secure page.

## Install and run

1. Clone the repository.

   ```bash
   git clone https://github.com/JH-Eric-Yang/AME.git
   cd AME
   ```

2. Install the dependencies for all workspaces.

   ```bash
   npm install
   ```

3. Make a file `.env` in the repository root. See [Configuration](#configuration).

4. Start PostgreSQL and Redis.

5. Apply the database migrations.

   ```bash
   cd server
   npx prisma migrate dev
   ```

6. Create the first administrator account from `ADMIN_EMAIL` and
   `ADMIN_PASSWORD`.

   ```bash
   npx prisma db seed
   ```

7. Start the server.

   ```bash
   npm run dev
   ```

8. In a second terminal, start the client.

   ```bash
   cd client
   npm run dev
   ```

9. Open the client URL and log in at `/admin/login`.

To get an example experiment, run `npm run seed:demo` from the repository root.

## Configuration

Put these values in `.env` in the repository root.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | The PostgreSQL connection string. |
| `REDIS_URL` | Yes | The Redis connection string. |
| `JWT_SECRET` | Yes | A long random string. The server signs login tokens with it. |
| `PORT` | No | The server port. The default is `3001`. |
| `CLIENT_URL` | No | The client origin. The server permits requests from it. |
| `ADMIN_EMAIL` | For the seed | The email of the first administrator. |
| `ADMIN_PASSWORD` | For the seed | The password of the first administrator. |
| `ADMIN_NAME` | No | The name of the first administrator. |
| `TURN_URLS` | No | TURN server URLs. Use with `TURN_SECRET`. |
| `TURN_SECRET` | No | The shared secret of the TURN server. |
| `TURN_TTL_SECONDS` | No | How long a TURN password stays valid. The default is 4 hours. |

The client reads the server URL from `VITE_SERVER_URL`. The client and the
server must use the same URL.

> **Warning:** Do not serve the TURN secret or the TURN password from an open
> URL. Other people can then use your relay.

Example:

```ini
DATABASE_URL=postgresql://ame:ame@localhost:5432/ame
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-this-to-a-long-random-string
PORT=3001
CLIENT_URL=http://localhost:5173
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this
```

## Tests

Run these commands from the repository root.

```bash
npm test --workspace server   # server unit tests (vitest)
npm test --workspace client   # client unit tests (vitest)
npm run test:e2e              # end-to-end tests (Playwright)
```

The end-to-end tests need PostgreSQL and Redis, with the migrations applied.
Playwright starts its own server and client and makes a temporary experiment.

## Project structure

```
AME/
├── client/    SvelteKit app: admin dashboard, experiment runner, phone page
├── server/    Express app: REST API, Socket.IO handlers, Prisma schema
├── shared/    TypeScript types and helpers for the client and the server
├── scripts/   Seed scripts for example experiments
└── e2e/       Playwright end-to-end tests
```

## Authors

- **Jiahao Eric Yang**, University of Bath
- **Sotaro Kita**, University of Warwick

To contact us, use the contact form on [ameexp.com](https://ameexp.com).

## Citation

If you use AME in your research, please cite:

> Yang, J., & Kita, S. *AME: The Autonomous Multimodal Experiment System.*
> Manuscript in preparation. https://ameexp.com

We will add the full reference when the paper is published.

## Funding

We thank the ESRC Impact Acceleration Account and the EPSRC Impact
Acceleration Account for their funding.

## License

AME is released under the [MIT License](LICENSE).
