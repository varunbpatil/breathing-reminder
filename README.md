# Breathing Reminder

A GNOME Shell extension that shows a thin animated bar at the screen edge to guide breathing. Supports configurable inhale, hold, and exhale phases with 15 built-in techniques, a full-screen guided session mode, idle auto-start, and more.

![Demo](demo.gif)

## Features

- **Animated progress bar** — thin bar at any screen edge fills and empties in sync with your breath
- **15 breathing techniques** — Box, 4-7-8, Coherent/HRV, Pranayama, Anti-Anxiety, Physiological Sigh, and more; quick-select from the panel menu
- **Phase countdown** — live arrow + seconds in the panel icon (e.g. `↑ 3`)
- **Guided session mode** — full-screen overlay with phase name, countdown, cycle counter, and session timer; press Escape or click End Session to dismiss
- **Color crossfade** — smooth color transition between phases
- **Pulse on hold** — gentle opacity oscillation during hold phases to signal "stay here"
- **Sound cues** — optional bell tone at each phase transition
- **Idle auto-start** — automatically shows the bar after a configurable period of inactivity; hides when you return
- **Lock screen auto-pause** — bar pauses when screen locks and resumes when you log back in
- **Multi-monitor** — show bar on all monitors, the primary, or a specific display index
- **Fully configurable** — colors, bar thickness, opacity, position (top/bottom/left/right), session duration, idle threshold

## Requirements

- GNOME Shell 48 or later

## Installation

```bash
git clone https://github.com/varunbpatil/breathing-reminder
cd breathing-reminder
bash install.sh
```

The script handles schema compilation and will disable/re-enable the extension automatically if it is already installed (useful for updates).

## Usage

After enabling, a breathing icon appears in the panel.

- **Toggle on/off** — click the panel icon → flip the switch
- **Change technique** — click the panel icon → Technique submenu
- **Start a guided session** — click the panel icon → Start Session
- **Open preferences** — click the panel icon → Preferences

## Breathing Techniques

| Technique           | Pattern (inhale · hold · exhale · hold) | Use case                   |
|---------------------|-----------------------------------------|----------------------------|
| Box Breathing       | 4 · 4 · 4 · 4                           | Focus, stress relief       |
| Triangle            | 4 · 4 · 4 · 0                           | Three-phase balance        |
| 4-7-8               | 4 · 7 · 8 · 0                           | Deep relaxation            |
| Pranayama 1:4:2     | 4 · 16 · 8 · 0                          | Classic yogic ratio        |
| Coherent / HRV      | 5 · 0 · 5 · 0                           | Heart rate variability     |
| Equal / Samavritti  | 6 · 0 · 6 · 0                           | Yoga foundation            |
| Vagal Tone          | 5 · 0 · 7 · 0                           | Parasympathetic activation |
| Anti-Anxiety        | 4 · 0 · 8 · 0                           | Acute calm                 |
| Relaxing Breath     | 4 · 0 · 6 · 2                           | Extended exhale            |
| Gentle Calm         | 2 · 1 · 4 · 1                           | Short, easy cycles         |
| Sleep / Wind Down   | 4 · 0 · 8 · 2                           | Sleep onset                |
| Physiological Sigh  | 2 · 0 · 8 · 0                           | Quick reset                |
| Buteyko             | 2 · 0 · 3 · 2                           | CO₂ tolerance              |
| Energizing          | 6 · 0 · 2 · 0                           | Alertness                  |
| Beginner            | 3 · 0 · 3 · 0                           | Easy start                 |

Custom phase durations can be set in Preferences.

## Development

```bash
# After editing extension.js or prefs.js, reload:
gnome-extensions disable breathing-reminder@varunbpatil
gnome-extensions enable breathing-reminder@varunbpatil

# After editing the schema XML, recompile before reloading:
glib-compile-schemas schemas/
```

Logs appear in the GNOME Shell journal:

```bash
journalctl -f /usr/bin/gnome-shell
```

## Disclaimer

This extension is intended as a general wellness tool and is not a medical device. The breathing techniques included are for informational purposes only. Consult a qualified healthcare professional before using breathing exercises if you have any respiratory, cardiovascular, or other medical conditions. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE).
