import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Cairo from "gi://cairo";
import Meta from "gi://Meta";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASES = ["inhale", "hold-in", "exhale", "hold-out"];

const PHASE_ARROWS  = { "inhale": "↑", "hold-in": "◆", "exhale": "↓", "hold-out": "◇" };

const DURATION_KEYS = {
    "inhale": "inhale-duration", "hold-in": "hold-in-duration",
    "exhale": "exhale-duration", "hold-out": "hold-out-duration",
};
const COLOR_KEYS = {
    "inhale": "inhale-color", "hold-in": "hold-color",
    "exhale": "exhale-color", "hold-out": "hold-color",
};

// Preset data duplicated here so panel quick-select works without importing prefs.js
const PRESETS = {
    box:            { label: "Box Breathing",        inhale: 4,  holdIn: 4,  exhale: 4,  holdOut: 4  },
    triangle:       { label: "Triangle",             inhale: 4,  holdIn: 4,  exhale: 4,  holdOut: 0  },
    "4-7-8":        { label: "4-7-8",                inhale: 4,  holdIn: 7,  exhale: 8,  holdOut: 0  },
    pranayama:      { label: "Pranayama 1:4:2",      inhale: 4,  holdIn: 16, exhale: 8,  holdOut: 0  },
    coherent:       { label: "Coherent / HRV",       inhale: 5,  holdIn: 0,  exhale: 5,  holdOut: 0  },
    equal:          { label: "Equal / Samavritti",   inhale: 6,  holdIn: 0,  exhale: 6,  holdOut: 0  },
    vagal:          { label: "Vagal Tone",           inhale: 5,  holdIn: 0,  exhale: 7,  holdOut: 0  },
    "anti-anxiety": { label: "Anti-Anxiety",         inhale: 4,  holdIn: 0,  exhale: 8,  holdOut: 0  },
    relaxing:       { label: "Relaxing Breath",      inhale: 4,  holdIn: 0,  exhale: 6,  holdOut: 2  },
    "2-1-4-1":      { label: "Gentle Calm",          inhale: 2,  holdIn: 1,  exhale: 4,  holdOut: 1  },
    "4-0-8-2":      { label: "Sleep / Wind Down",    inhale: 4,  holdIn: 0,  exhale: 8,  holdOut: 2  },
    sigh:           { label: "Physiological Sigh",   inhale: 2,  holdIn: 0,  exhale: 8,  holdOut: 0  },
    buteyko:        { label: "Buteyko",              inhale: 2,  holdIn: 0,  exhale: 3,  holdOut: 2  },
    energize:       { label: "Energizing",           inhale: 6,  holdIn: 0,  exhale: 2,  holdOut: 0  },
    beginner:       { label: "Beginner",             inhale: 3,  holdIn: 0,  exhale: 3,  holdOut: 0  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
        r: parseInt(h.slice(0, 2), 16) / 255,
        g: parseInt(h.slice(2, 4), 16) / 255,
        b: parseInt(h.slice(4, 6), 16) / 255,
    };
}

function lerpColor(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// ── BreathingBar ──────────────────────────────────────────────────────────────
// Manages one drawing area per active monitor, animation state, sound.

class BreathingBar {
    constructor(settings) {
        this._settings = settings;
        this._phase = "inhale";
        this._phaseStartTime = null;
        this._progress = 0;
        this._running = false;
        this._timerId = 0;
        this._signalIds = [];
        this._areas = [];            // one St.DrawingArea per monitor
        this._unredirectDisabled = false;

        // Color crossfade state
        this._transFrom = null;
        this._transTo = null;
        this._transStart = null;

        // Hold pulse (opacity modulation during hold phases)
        this._holdPulse = 1.0;

        // Completed cycle counter (increments each time we return to inhale)
        this._cycleCount = 0;

        for (const key of ["bar-position", "bar-thickness", "monitor"]) {
            this._signalIds.push(this._settings.connect(`changed::${key}`, () => this._rebuildAreas()));
        }
        for (const key of ["inhale-color", "exhale-color", "hold-color", "opacity",
                            "color-crossfade", "pulse-on-hold"]) {
            this._signalIds.push(this._settings.connect(`changed::${key}`, () => this._repaintAll()));
        }

        this._monitorChangedId = Main.layoutManager.connect("monitors-changed", () => this._rebuildAreas());
        this._rebuildAreas();
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    get phase()      { return this._phase; }
    get running()    { return this._running; }
    get cycleCount() { return this._cycleCount; }

    get phaseRemaining() {
        if (!this._phaseStartTime || !this._running) return 0;
        const elapsed = (GLib.get_monotonic_time() - this._phaseStartTime) / 1_000_000;
        return Math.max(0, this._getPhaseDuration(this._phase) - elapsed);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        this._running = true;
        this._phase = "inhale";
        this._phaseStartTime = GLib.get_monotonic_time();
        this._progress = 0;
        this._cycleCount = 0;
        this._holdPulse = 1.0;
        this._transStart = null;

        for (const area of this._areas) {
            area.show();
            Main.uiGroup.set_child_above_sibling(area, null);
        }
        if (!this._unredirectDisabled) {
            global.compositor.disable_unredirect();
            this._unredirectDisabled = true;
        }
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._running) return GLib.SOURCE_REMOVE;
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (!this._running) return;
        this._running = false;
        if (this._timerId > 0) { GLib.source_remove(this._timerId); this._timerId = 0; }
        if (this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
        }
        for (const area of this._areas) area.hide();
    }

    // Reset phase without stop/start (no flicker when changing technique mid-session)
    restart() {
        if (!this._running) { this.start(); return; }
        this._phase = "inhale";
        this._phaseStartTime = GLib.get_monotonic_time();
        this._progress = 0;
        this._cycleCount = 0;
        this._holdPulse = 1.0;
        this._transStart = null;
    }

    // ── Animation ─────────────────────────────────────────────────────────────

    _getPhaseDuration(phase) {
        return this._settings.get_double(DURATION_KEYS[phase]);
    }

    _nextPhase(current) {
        const idx = PHASES.indexOf(current);
        for (let i = 1; i <= PHASES.length; i++) {
            const phase = PHASES[(idx + i) % PHASES.length];
            if (this._getPhaseDuration(phase) > 0) return phase;
        }
        return "inhale";
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const elapsed = (now - this._phaseStartTime) / 1_000_000;
        const duration = this._getPhaseDuration(this._phase);

        if (elapsed >= duration) {
            const excess = elapsed - duration;
            const prevPhase = this._phase;
            this._phase = this._nextPhase(prevPhase);
            this._phaseStartTime = now - Math.round(excess * 1_000_000);

            // Count cycle on return to inhale
            if (this._phase === "inhale") this._cycleCount++;

            // Kick off color crossfade
            if (this._settings.get_boolean("color-crossfade")) {
                this._transFrom  = hexToRgb(this._settings.get_string(COLOR_KEYS[prevPhase]));
                this._transTo    = hexToRgb(this._settings.get_string(COLOR_KEYS[this._phase]));
                this._transStart = now;
            }

            this._playPhaseSound();
        }

        const phaseElapsed  = (now - this._phaseStartTime) / 1_000_000;
        const phaseDuration = this._getPhaseDuration(this._phase);
        const t = phaseDuration > 0 ? Math.min(phaseElapsed / phaseDuration, 1.0) : 1.0;

        switch (this._phase) {
            case "inhale":
                this._progress  = t;
                this._holdPulse = 1.0;
                break;
            case "hold-in":
                this._progress  = 1.0;
                this._holdPulse = this._settings.get_boolean("pulse-on-hold")
                    ? 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(phaseElapsed * Math.PI / 2))
                    : 1.0;
                break;
            case "exhale":
                this._progress  = 1.0 - t;
                this._holdPulse = 1.0;
                break;
            case "hold-out":
                this._progress  = 0.0;
                this._holdPulse = this._settings.get_boolean("pulse-on-hold")
                    ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(phaseElapsed * Math.PI / 2))
                    : 0.35;  // keep track subtly visible when not pulsing
                break;
        }

        this._repaintAll();
    }

    // ── Drawing areas (multi-monitor) ─────────────────────────────────────────

    _repaintAll() {
        for (const area of this._areas) {
            if (area.visible) area.queue_repaint();
        }
    }

    _rebuildAreas() {
        for (const area of this._areas) {
            Main.uiGroup.remove_child(area);
            area.destroy();
        }
        this._areas = [];

        const idx = this._settings.get_int("monitor");
        const allMonitors = Main.layoutManager.monitors;
        const targets =
            idx === -2                            ? allMonitors :
            idx >= 0 && idx < allMonitors.length  ? [allMonitors[idx]] :
                                                    [Main.layoutManager.primaryMonitor];

        if (!targets || targets.length === 0) return;

        for (const mon of targets) {
            if (!mon) continue;
            const area = new St.DrawingArea({ reactive: false, can_focus: false, track_hover: false });
            area.connect("repaint", this._onRepaint.bind(this));
            Main.uiGroup.add_child(area);
            if (this._running) {
                area.show();
                Main.uiGroup.set_child_above_sibling(area, null);
            } else {
                area.hide();
            }
            this._positionArea(area, mon);
            this._areas.push(area);
        }
    }

    _positionArea(area, monitor) {
        const pos       = this._settings.get_string("bar-position");
        const thickness = this._settings.get_int("bar-thickness");
        let x, y, w, h;
        switch (pos) {
            case "bottom": [x, y, w, h] = [monitor.x, monitor.y + monitor.height - thickness, monitor.width, thickness]; break;
            case "left":   [x, y, w, h] = [monitor.x, monitor.y, thickness, monitor.height]; break;
            case "right":  [x, y, w, h] = [monitor.x + monitor.width - thickness, monitor.y, thickness, monitor.height]; break;
            default:       [x, y, w, h] = [monitor.x, monitor.y, monitor.width, thickness]; // top
        }
        area.set_position(x, y);
        area.set_size(w, h);
    }

    _getColor() {
        const base = hexToRgb(this._settings.get_string(COLOR_KEYS[this._phase]));
        if (!this._transStart || !this._settings.get_boolean("color-crossfade")) return base;
        const elapsed = (GLib.get_monotonic_time() - this._transStart) / 1_000_000;
        const t = Math.min(elapsed / 0.45, 1.0);
        if (t >= 1.0) { this._transStart = null; return base; }
        return lerpColor(this._transFrom, this._transTo, t);
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        const color        = this._getColor();
        const opacity      = this._settings.get_double("opacity") * this._holdPulse;
        const isHorizontal = ["top", "bottom"].includes(this._settings.get_string("bar-position"));

        // Dim background track — stays visible even at 0 progress (hold-out)
        cr.setSourceRGBA(color.r, color.g, color.b, opacity * 0.18);
        cr.rectangle(0, 0, w, h);
        cr.fill();

        // Progress fill
        cr.setSourceRGBA(color.r, color.g, color.b, opacity);
        if (isHorizontal) {
            cr.rectangle(0, 0, w * this._progress, h);
        } else {
            const fh = h * this._progress;
            cr.rectangle(0, h - fh, w, fh);
        }
        cr.fill();

        cr.$dispose();
    }

    // ── Sound ─────────────────────────────────────────────────────────────────

    _playPhaseSound() {
        if (!this._settings.get_boolean("sound-enabled")) return;
        try {
            global.display.get_sound_player().play_from_theme("bell", "Breathing phase", null);
        } catch (_) { /* sound not available — silent fail */ }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
        this.stop();
        if (this._monitorChangedId) {
            Main.layoutManager.disconnect(this._monitorChangedId);
            this._monitorChangedId = null;
        }
        for (const id of this._signalIds) this._settings.disconnect(id);
        this._signalIds = [];
        for (const area of this._areas) { Main.uiGroup.remove_child(area); area.destroy(); }
        this._areas = [];
    }
}

// ── BreathingSession ──────────────────────────────────────────────────────────
// Full-screen guided session overlay. Blocking (grabs input). Escape / button to end.

const BreathingSession = GObject.registerClass(
class BreathingSession extends St.Widget {
    _init(settings, bar, onEnd) {
        super._init({
            reactive: true,
            can_focus: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._settings = settings;
        this._bar      = bar;
        this._onEnd    = onEnd;
        this._alive    = true;
        this._unredirectDisabled = false;

        this._mode = settings.get_string("session-end-mode");
        if (this._mode === "cycles") {
            this._targetCycles    = settings.get_int("session-cycles");
            this._startCycleCount = bar.cycleCount;
        } else {
            this._remaining = settings.get_int("session-duration") * 60;
        }

        // Backdrop
        const backdrop = new St.Widget({
            x_expand: true, y_expand: true,
            style: "background-color: rgba(0,0,0,0.82);",
        });
        this.add_child(backdrop);

        // Content box
        const content = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: "spacing: 14px; padding: 56px;",
        });

        this._arrowLbl    = new St.Label({ style: "font-size: 72px; text-align: center;", x_align: Clutter.ActorAlign.CENTER });
        this._phaseLbl    = new St.Label({ style: "font-size: 50px; font-weight: bold; text-align: center;", x_align: Clutter.ActorAlign.CENTER });
        this._phaseSecLbl = new St.Label({ style: "font-size: 22px; color: rgba(255,255,255,0.55); text-align: center;", x_align: Clutter.ActorAlign.CENTER });

        const divider = new St.Widget({ style: "background-color: rgba(255,255,255,0.12); height: 1px; margin: 6px 0;", x_expand: true });

        this._cycleLbl = new St.Label({ style: "font-size: 18px; color: rgba(255,255,255,0.5); text-align: center;", x_align: Clutter.ActorAlign.CENTER });
        this._timeLbl  = new St.Label({ style: "font-size: 15px; color: rgba(255,255,255,0.35); text-align: center;", x_align: Clutter.ActorAlign.CENTER });

        const hint = new St.Label({
            text: "Press Escape to end session",
            style: "font-size: 12px; color: rgba(255,255,255,0.22); text-align: center; margin-top: 6px;",
            x_align: Clutter.ActorAlign.CENTER,
        });

        const endBtn = new St.Button({
            label: "End Session",
            style: [
                "background-color: rgba(255,255,255,0.1);",
                "border: 1px solid rgba(255,255,255,0.22);",
                "border-radius: 6px;",
                "color: rgba(255,255,255,0.75);",
                "font-size: 14px;",
                "padding: 10px 30px;",
                "margin-top: 18px;",
            ].join(" "),
        });
        endBtn.connect("clicked", () => this.end());

        content.add_child(this._arrowLbl);
        content.add_child(this._phaseLbl);
        content.add_child(this._phaseSecLbl);
        content.add_child(divider);
        content.add_child(this._cycleLbl);
        content.add_child(this._timeLbl);
        content.add_child(endBtn);
        content.add_child(hint);
        this.add_child(content);

        // Cover full stage
        Main.uiGroup.add_child(this);
        this.set_position(0, 0);
        this.set_size(global.screen_width, global.screen_height);
        Main.uiGroup.set_child_above_sibling(this, null);

        if (!this._unredirectDisabled) {
            global.compositor.disable_unredirect();
            this._unredirectDisabled = true;
        }

        // Fade in
        this.set_opacity(0);
        this.ease({ opacity: 255, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        this._grab  = global.stage.grab(this);
        this.grab_key_focus();
        this._keyId = this.connect("key-press-event", (_, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) { this.end(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });

        // Update display at ~5fps (session HUD doesn't need 60fps)
        this._displayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            if (!this._alive) return GLib.SOURCE_REMOVE;
            this._updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });

        // Session countdown — 1s tick (duration mode only)
        this._countdownId = 0;
        if (this._mode !== "cycles") {
            this._countdownId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (!this._alive) return GLib.SOURCE_REMOVE;
                this._remaining = Math.max(0, this._remaining - 1);
                if (this._remaining === 0) { this.end(); return GLib.SOURCE_REMOVE; }
                return GLib.SOURCE_CONTINUE;
            });
        }

        this._updateDisplay();
    }

    _updateDisplay() {
        const phase  = this._bar.phase;
        const color  = this._settings.get_string(COLOR_KEYS[phase]);
        const secRem = Math.ceil(this._bar.phaseRemaining);

        const phaseNames = { "inhale": "Inhale", "hold-in": "Hold", "exhale": "Exhale", "hold-out": "Hold" };

        this._arrowLbl.text  = PHASE_ARROWS[phase] || "●";
        this._arrowLbl.style = `font-size: 72px; text-align: center; color: ${color};`;

        this._phaseLbl.text  = phaseNames[phase] || "";
        this._phaseLbl.style = `font-size: 50px; font-weight: bold; text-align: center; color: ${color};`;

        this._phaseSecLbl.text = `${secRem}s`;

        if (this._mode === "cycles") {
            const done = this._bar.cycleCount - this._startCycleCount;
            const left = this._targetCycles - done;
            this._cycleLbl.text = `Cycle ${done + 1} of ${this._targetCycles}`;
            this._timeLbl.text  = left > 0 ? `${left} cycle${left !== 1 ? "s" : ""} remaining` : "Done!";
            if (done >= this._targetCycles) { this.end(); return; }
        } else {
            this._cycleLbl.text = `Cycle ${this._bar.cycleCount + 1}`;
            const m = Math.floor(this._remaining / 60);
            const s = this._remaining % 60;
            this._timeLbl.text = `${m}:${String(s).padStart(2, "0")} remaining`;
        }
    }

    end() {
        if (!this._alive) return;
        this._alive = false;

        if (this._displayId > 0)   { GLib.source_remove(this._displayId);   this._displayId   = 0; }
        if (this._countdownId > 0) { GLib.source_remove(this._countdownId); this._countdownId = 0; }

        this.ease({
            opacity: 0, duration: 300, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._keyId)  { this.disconnect(this._keyId); this._keyId = null; }
                if (this._grab)   { this._grab.dismiss(); this._grab = null; }
                if (this._unredirectDisabled) {
                    global.compositor.enable_unredirect();
                    this._unredirectDisabled = false;
                }
                Main.uiGroup.remove_child(this);
                this.destroy();
                this._onEnd?.();
            },
        });
    }
});

// ── BreathingIndicator ────────────────────────────────────────────────────────
// Panel button: icon + live phase countdown, toggle, technique submenu, session.

const BreathingIndicator = GObject.registerClass(
class BreathingIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, "Breathing Reminder");

        this._extension = extension;
        this._settings  = extension.getSettings();
        this._bar       = null;
        this._session   = null;

        // Panel button: icon + live countdown
        const box = new St.BoxLayout({ style: "spacing: 3px; padding: 0 8px;" });
        this._icon = new St.Icon({ icon_name: "media-playback-start-symbolic", icon_size: 16 });
        this._countdownLbl = new St.Label({
            text: "", y_align: Clutter.ActorAlign.CENTER,
            style: "font-size: 14px;",
        });
        box.add_child(this._icon);
        box.add_child(this._countdownLbl);
        this.add_child(box);

        // ── Menu items ────────────────────────────────────────────────────────

        // On/off toggle
        this._toggleItem = new PopupMenu.PopupSwitchMenuItem(
            "Breathing Reminder", this._settings.get_boolean("enabled")
        );
        this._toggleItem.connect("toggled", (item) => this._settings.set_boolean("enabled", item.state));
        this._toggleItem.activate = function (_e) { this.toggle(); };
        this.menu.addMenuItem(this._toggleItem);

        // Live phase info (non-interactive label)
        this._phaseItem = new PopupMenu.PopupMenuItem("—", { reactive: false });
        this.menu.addMenuItem(this._phaseItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Session start/end
        this._sessionItem = new PopupMenu.PopupMenuItem("▶  Start Session");
        this._sessionItem.connect("activate", () => {
            if (this._session) this._session.end();
            else this._startSession();
        });
        this.menu.addMenuItem(this._sessionItem);

        // Technique quick-select submenu
        const techMenu = new PopupMenu.PopupSubMenuMenuItem("Technique");
        for (const [key, p] of Object.entries(PRESETS)) {
            const item = new PopupMenu.PopupMenuItem(p.label);
            item.connect("activate", () => {
                this._settings.set_string("preset",            key);
                this._settings.set_double("inhale-duration",   p.inhale);
                this._settings.set_double("hold-in-duration",  p.holdIn);
                this._settings.set_double("exhale-duration",   p.exhale);
                this._settings.set_double("hold-out-duration", p.holdOut);
                if (this._bar?.running) this._bar.restart();
            });
            techMenu.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(techMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem("Preferences");
        prefsItem.connect("activate", () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);

        // Sync icon opacity with enabled state
        this._enabledId = this._settings.connect("changed::enabled", () => {
            this._toggleItem.setToggleState(this._settings.get_boolean("enabled"));
            this._syncIcon();
        });
        this._syncIcon();

        // Poll every 400ms to update live phase/countdown
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._updatePhaseLabel();
            return GLib.SOURCE_CONTINUE;
        });
    }

    setBar(bar) { this._bar = bar; }

    _syncIcon() {
        this._icon.set_opacity(this._settings.get_boolean("enabled") ? 255 : 100);
    }

    _startSession() {
        if (!this._bar) return;
        this._sessionStartedBar = !this._bar.running;
        if (!this._bar.running) {
            this._settings.set_boolean("enabled", true);
            this._bar.start();
        }
        this._session = new BreathingSession(this._settings, this._bar, () => {
            this._session = null;
            this._sessionItem.label.text = "▶  Start Session";
            // Restore bar to pre-session state if we started it
            if (this._sessionStartedBar) {
                this._sessionStartedBar = false;
                this._settings.set_boolean("enabled", false);
                this._bar.stop();
            }
        });
        this._sessionItem.label.text = "■  End Session";
    }

    _updatePhaseLabel() {
        if (!this._bar || !this._bar.running) {
            this._phaseItem.label.text  = "Paused";
            this._phaseItem.label.style = "color: #888;";
            this._countdownLbl.text     = "";
            return;
        }
        const phaseNames = { "inhale": "Inhale", "hold-in": "Hold", "exhale": "Exhale", "hold-out": "Hold" };
        const phase   = this._bar.phase;
        const color   = this._settings.get_string(COLOR_KEYS[phase]);
        const sec     = Math.ceil(this._bar.phaseRemaining);
        const arrow   = PHASE_ARROWS[phase];

        this._phaseItem.label.text  = `${arrow} ${phaseNames[phase]}  ${sec}s`;
        this._phaseItem.label.style = `color: ${color};`;
        this._countdownLbl.text     = `${arrow}${sec}`;
        this._countdownLbl.style    = `font-size: 14px; color: ${color};`;
    }

    destroy() {
        if (this._pollId > 0)  { GLib.source_remove(this._pollId); this._pollId = 0; }
        if (this._enabledId)   { this._settings.disconnect(this._enabledId); this._enabledId = null; }
        if (this._session)     { this._session.end(); this._session = null; }
        super.destroy();
    }
});

// ── BreathingReminderExtension ────────────────────────────────────────────────

export default class BreathingReminderExtension extends Extension {
    _loadSettings() {
        const src = Gio.SettingsSchemaSource.new_from_directory(
            this.dir.get_child("schemas").get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const obj = src.lookup("org.gnome.shell.extensions.breathing-reminder", true);
        if (!obj) throw new Error("Schema org.gnome.shell.extensions.breathing-reminder not found");
        return new Gio.Settings({ settings_schema: obj });
    }

    getSettings() { return this._settings; }

    enable() {
        this._settings = this._loadSettings();
        this._bar      = new BreathingBar(this._settings);
        this._indicator = new BreathingIndicator(this);
        this._indicator.setBar(this._bar);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Enabled toggle
        this._enabledId = this._settings.connect("changed::enabled", () => {
            if (this._settings.get_boolean("enabled")) this._bar.start();
            else this._bar.stop();
        });
        if (this._settings.get_boolean("enabled")) this._bar.start();

        // Lock screen auto-pause
        this._pausedByLock = false;
        this._sessionModeId = Main.sessionMode.connect("updated", () => {
            const userMode = Main.sessionMode.currentMode === "user";
            if (!userMode && this._bar.running) {
                this._bar.stop();
                this._pausedByLock = true;
            } else if (userMode && this._pausedByLock) {
                this._pausedByLock = false;
                if (this._settings.get_boolean("enabled")) this._bar.start();
            }
        });

        // Idle auto-start
        this._idleMonitor  = null;
        this._idleWatchId  = null;
        this._activeWatchId = null;
        this._idleStarted  = false;
        this._setupIdleMonitor();

        this._idleAutoId = this._settings.connect("changed::idle-auto-start", () => this._setupIdleMonitor());
        this._idleDurId  = this._settings.connect("changed::idle-duration",   () => this._setupIdleMonitor());
    }

    disable() {
        if (this._enabledId)    { this._settings.disconnect(this._enabledId);    this._enabledId    = null; }
        if (this._idleAutoId)   { this._settings.disconnect(this._idleAutoId);   this._idleAutoId   = null; }
        if (this._idleDurId)    { this._settings.disconnect(this._idleDurId);    this._idleDurId    = null; }
        if (this._sessionModeId){ Main.sessionMode.disconnect(this._sessionModeId); this._sessionModeId = null; }

        this._clearIdleWatches();

        if (this._bar)       { this._bar.destroy();       this._bar       = null; }
        if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
        this._settings = null;
        this._idleMonitor = null;
    }

    // ── Idle monitor ──────────────────────────────────────────────────────────

    _setupIdleMonitor() {
        this._clearIdleWatches();
        if (!this._settings.get_boolean("idle-auto-start")) return;
        try {
            if (!this._idleMonitor) this._idleMonitor = Meta.IdleMonitor.get_core();
            this._armIdleWatch();
        } catch (_) { /* idle monitor not available on this system */ }
    }

    _armIdleWatch() {
        if (!this._idleMonitor) return;
        const ms = this._settings.get_int("idle-duration") * 60 * 1000;
        this._idleWatchId = this._idleMonitor.add_idle_watch(ms, () => {
            this._idleWatchId = null;
            if (!this._bar.running) {
                this._idleStarted = true;
                this._bar.start();
            }
            // Arm active watch — when user returns, stop if we started it
            this._activeWatchId = this._idleMonitor.add_user_active_watch(() => {
                this._activeWatchId = null;
                if (this._idleStarted) {
                    this._idleStarted = false;
                    if (!this._settings.get_boolean("enabled") && this._bar.running)
                        this._bar.stop();
                }
                if (this._settings.get_boolean("idle-auto-start")) this._armIdleWatch();
            });
        });
    }

    _clearIdleWatches() {
        if (this._idleMonitor) {
            if (this._idleWatchId  !== null) { this._idleMonitor.remove_watch(this._idleWatchId);  this._idleWatchId  = null; }
            if (this._activeWatchId !== null) { this._idleMonitor.remove_watch(this._activeWatchId); this._activeWatchId = null; }
        }
        this._idleStarted = false;
    }
}
