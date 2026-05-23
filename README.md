# Director

Director is the companion app for Cue, a Raspberry Pi-based display manager. Built with Electron, director provides a simple interface for sending power and input commands to one or all displays in a location.

---

## tl;dr

- Director talks to the Cue API running on each Raspberry Pi
- One config file defines the location, displays, and API key
- Works on Windows, macOS, and Linux
- No server required, runs entirely on the local machine

---

## Getting Started

### Requirements

- Node.js 18 or later
- npm
- Cue running on each Pi you want to control

### Install and run

```bash
cd director
npm install
npm start
```

### Build a distributable

```bash
npm run build:win    # Windows .exe installer
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage
```

Built files are output to the `dist/` folder.

---

## Configuration

Feel free to edit `config.yml` to your liking prior to building the app. It can be changed later, so loook at this as your defaults.


### Configuration reference

| Field              | Description                                                        |
|--------------------|--------------------------------------------------------------------|
| `location`         | Friendly name shown in the app header                             |
| `api_key`          | Must match the `api_key` set in each Pi's Cue config              |
| `displays`         | List of displays to control                                        |
| `displays[].id`    | Unique identifier for the display, used internally                 |
| `displays[].name`  | Friendly name shown on the display card                           |
| `displays[].host`  | IP address of the Pi controlling this display                      |
| `displays[].port`  | Port the Cue API is listening on (default: 5000)                  |
| `displays[].inputs`| List of HDMI input numbers to show as buttons (e.g. [1, 2])      |

---

## Usage

### Display cards

Each display gets a card showing:

- Name and ID

- Status dot indicating the current state of that Pi
- On and Off buttons
- HDMI input buttons for each input defined in config

### Status dots

| Color  | Meaning                              |
|--------|--------------------------------------|
| Green  | Online and CEC bus ready             |
| Amber  | Online but CEC bus not ready         |
| Red    | Offline or unreachable               |

Status is checked automatically every 15 seconds. Click the refresh button in the top right to check immediately.

### All displays

The All On and All Off buttons at the top send the command to every display simultaneously.

---

## Multiple locations

To deploy Director for a different location, copy the `director` folder and update `config.yml` with the new location name, API key, and display list. The application itself is identical everywhere, only the config changes.

---

## Notes

- The `api_key` in `config.yml` must match the `api_key` configured on each Cue Pi. Requests with a mismatched or missing key will be rejected with a 401 error.
- Director communicates with the Cue API over plain HTTP on the local network. Do not expose the Cue API ports to the internet.
- If a display card shows amber, the Pi is reachable but the CEC bus is not ready. This typically means the TV is in deep sleep. Sending the On command will still attempt to wake it.

---

## About

Director is the desktop companion to [Cue](https://github.com/TheQuib/cue), a Raspberry Pi based CEC TV control service.
