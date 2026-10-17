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

## Contents

- [Use the hosted version](#use-the-hosted-version)
- [Why AME](#why-ame)
- [Features](#features)
- [How an experiment is built](#how-an-experiment-is-built)
- [Elements](#elements)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Install and run](#install-and-run)
- [Set up a production server](#set-up-a-production-server)
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

2. Start PostgreSQL and Redis.

3. Run the setup script.

   ```bash
   ./scripts/setup.sh
   ```

   The script checks the requirements, makes `.env` with a random JWT
   secret, installs the packages, applies the database migrations and makes
   the first administrator account. You can run it again: it keeps an
   existing `.env` and an existing account.

4. Start the server.

   ```bash
   npm run dev --workspace server
   ```

5. In a second terminal, start the client.

   ```bash
   npm run dev --workspace client
   ```

6. Open <http://localhost:5173/admin/login> and log in as the administrator.

To get an example experiment, run `npm run seed:demo`.

New experimenters register on the login page. The administrator approves each
new account in the **Accounts** tab of the dashboard.

To set up AME by hand instead, copy `.env.example` to `.env`, set the values,
then run `npm install`, `npx prisma migrate deploy` in `server/`, and
`npx prisma db seed` in `server/` with `ADMIN_EMAIL`, `ADMIN_PASSWORD` and
`ADMIN_NAME` set in the shell.

## Set up a production server

`scripts/deploy.sh` sets up AME on a fresh Ubuntu server (22.04 or later).

> **Warning:** Browsers give camera access only on an HTTPS page. Point the
> DNS record of your domain to the server before you start, so that the
> script can get a certificate.

1. Open ports 22, 80 and 443 in the firewall of your cloud provider. For the
   TURN relay, also open 3478 (UDP and TCP) and 49160–49200 (UDP).
2. Clone the repository on the server and run the script as root.

   ```bash
   git clone https://github.com/JH-Eric-Yang/AME.git
   cd AME
   sudo ./scripts/deploy.sh
   ```

3. Give the domain, the administrator account and your TURN choice when the
   script asks for them.

The script installs Node.js, PostgreSQL, Redis, nginx, certbot, PM2 and
(optionally) coturn. It runs AME as the system user `ame` from `/opt/ame`,
with the configuration in `/opt/ame/.env`. nginx sends `/api/`,
`/socket.io/` and `/health` to the server (port 3001) and all other paths to
the client (port 3000).

To install a new version later, run `sudo /opt/ame/scripts/update.sh`.

## Configuration

Put these values in `.env` in the repository root. The server and the client
both read this file. `.env.example` shows each value.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | The PostgreSQL connection string. |
| `REDIS_URL` | Yes | The Redis connection string. |
| `JWT_SECRET` | Yes | A long random string. The server signs login tokens with it. |
| `PORT` | No | The server port. The default is `3001`. |
| `CLIENT_URL` | No | The client origin. In production, the server permits requests only from it. |
| `VITE_SERVER_URL` | In production | The URL at which the browser reaches the server, for example `https://ame.example.org`. The client reads it when you build it. In development, leave it empty: the client then uses port 3001 on the same host. |
| `TURN_URLS` | No | TURN server URLs. Use with `TURN_SECRET`. |
| `TURN_SECRET` | No | The shared secret of the TURN server. |
| `TURN_TTL_SECONDS` | No | How long a TURN password stays valid. The default is 4 hours. |

In production, the server does not start without `JWT_SECRET`.

> **Warning:** Do not serve the TURN secret or the TURN password from an open
> URL. Other people can then use your relay.

The seed reads the first administrator from `ADMIN_EMAIL`, `ADMIN_PASSWORD`
and `ADMIN_NAME`. Give these in the shell, not in `.env`, so that the
password does not stay in a file. `scripts/setup.sh` does this for you.

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
├── scripts/   Setup, deploy and update scripts, and seeds for example experiments
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
