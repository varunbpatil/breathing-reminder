import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// label: shown in dropdown; desc: subtitle when selected; timing values in seconds
const PRESETS = {
    box:            { label: "Box Breathing",         desc: "4 · 4 · 4 · 4 — Focus & stress relief (Navy SEALs)",            inhale: 4,   holdIn: 4,   exhale: 4,   holdOut: 4   },
    triangle:       { label: "Triangle",              desc: "4 · 4 · 4 · 0 — Three-phase balance",                           inhale: 4,   holdIn: 4,   exhale: 4,   holdOut: 0   },
    "4-7-8":        { label: "4-7-8",                 desc: "4 · 7 · 8 · 0 — Deep relaxation (Dr. Weil)",                    inhale: 4,   holdIn: 7,   exhale: 8,   holdOut: 0   },
    pranayama:      { label: "Pranayama 1:4:2",       desc: "4 · 16 · 8 · 0 — Classic yogic ratio",                          inhale: 4,   holdIn: 16,  exhale: 8,   holdOut: 0   },
    coherent:       { label: "Coherent / HRV",        desc: "5 · 0 · 5 · 0 — Resonant frequency for heart rate variability",  inhale: 5,   holdIn: 0,   exhale: 5,   holdOut: 0   },
    equal:          { label: "Equal / Samavritti",    desc: "6 · 0 · 6 · 0 — Yoga foundation breathing",                     inhale: 6,   holdIn: 0,   exhale: 6,   holdOut: 0   },
    vagal:          { label: "Vagal Tone",            desc: "5 · 0 · 7 · 0 — Longer exhale activates parasympathetic",       inhale: 5,   holdIn: 0,   exhale: 7,   holdOut: 0   },
    "anti-anxiety": { label: "Anti-Anxiety",          desc: "4 · 0 · 8 · 0 — Double exhale length for acute calm",           inhale: 4,   holdIn: 0,   exhale: 8,   holdOut: 0   },
    relaxing:       { label: "Relaxing Breath",       desc: "4 · 0 · 6 · 2 — Extended exhale with empty pause",              inhale: 4,   holdIn: 0,   exhale: 6,   holdOut: 2   },
    "2-1-4-1":      { label: "Gentle Calm",           desc: "2 · 1 · 4 · 1 — Short cycles, easy to sustain",                inhale: 2,   holdIn: 1,   exhale: 4,   holdOut: 1   },
    "4-0-8-2":      { label: "Sleep / Wind Down",     desc: "4 · 0 · 8 · 2 — Extended exhale + pause for sleep onset",       inhale: 4,   holdIn: 0,   exhale: 8,   holdOut: 2   },
    sigh:           { label: "Physiological Sigh",    desc: "2 · 0 · 8 · 0 — Quick inhale, long slow exhale (approx.)",      inhale: 2,   holdIn: 0,   exhale: 8,   holdOut: 0   },
    buteyko:        { label: "Buteyko",               desc: "2 · 0 · 3 · 2 — Reduced breathing for CO₂ tolerance",           inhale: 2,   holdIn: 0,   exhale: 3,   holdOut: 2   },
    energize:       { label: "Energizing",            desc: "6 · 0 · 2 · 0 — Long inhale, short exhale for alertness",       inhale: 6,   holdIn: 0,   exhale: 2,   holdOut: 0   },
    beginner:       { label: "Beginner",              desc: "3 · 0 · 3 · 0 — Simple equal breathing, easy start",            inhale: 3,   holdIn: 0,   exhale: 3,   holdOut: 0   },
    custom:         { label: "Custom",                desc: "Manually configured durations",                                  inhale: null, holdIn: null, exhale: null, holdOut: null },
};

const PRESET_KEYS = Object.keys(PRESETS);

function hexToRgba(hex) {
    const rgba = new Gdk.RGBA();
    rgba.parse(hex);
    return rgba;
}

function rgbaToHex(rgba) {
    const r = Math.round(rgba.red   * 255).toString(16).padStart(2, "0");
    const g = Math.round(rgba.green * 255).toString(16).padStart(2, "0");
    const b = Math.round(rgba.blue  * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
}

function detectPreset(settings) {
    const cur = {
        inhale:  settings.get_double("inhale-duration"),
        holdIn:  settings.get_double("hold-in-duration"),
        exhale:  settings.get_double("exhale-duration"),
        holdOut: settings.get_double("hold-out-duration"),
    };
    for (const [key, p] of Object.entries(PRESETS)) {
        if (key === "custom") continue;
        if (p.inhale === cur.inhale && p.holdIn === cur.holdIn &&
            p.exhale === cur.exhale && p.holdOut === cur.holdOut) return key;
    }
    return "custom";
}

// Helper: integer SpinRow bound to a GSettings int key (SpinRow.value is double)
function intSpinRow(settings, key, title, subtitle, lower, upper, step = 1) {
    const adj = new Gtk.Adjustment({ lower, upper, step_increment: step, value: settings.get_int(key) });
    const row = new Adw.SpinRow({ title, subtitle, adjustment: adj, digits: 0 });
    adj.connect("value-changed", () => settings.set_int(key, Math.round(adj.value)));
    settings.connect(`changed::${key}`, () => {
        const v = settings.get_int(key);
        if (Math.round(adj.value) !== v) adj.set_value(v);
    });
    return row;
}

export default class BreathingReminderPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const src = Gio.SettingsSchemaSource.new_from_directory(
            this.dir.get_child("schemas").get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const obj = src.lookup("org.gnome.shell.extensions.breathing-reminder", true);
        if (!obj) throw new Error("Schema org.gnome.shell.extensions.breathing-reminder not found");
        const settings = new Gio.Settings({ settings_schema: obj });

        window.set_default_size(640, 900);

        const page = new Adw.PreferencesPage({
            title: "Breathing Reminder",
            icon_name: "preferences-system-symbolic",
        });
        window.add(page);

        // ── Breathing ─────────────────────────────────────────────────────────
        const breathingGroup = new Adw.PreferencesGroup({ title: "Breathing" });
        page.add(breathingGroup);

        const enableRow = new Adw.SwitchRow({ title: "Enable", subtitle: "Show bar and run breathing animation" });
        settings.bind("enabled", enableRow, "active", Gio.SettingsBindFlags.DEFAULT);
        breathingGroup.add(enableRow);

        // Preset selector with dynamic subtitle
        const presetRow = new Adw.ComboRow({ title: "Technique" });
        const presetModel = new Gtk.StringList();
        Object.values(PRESETS).forEach(p => presetModel.append(p.label));
        presetRow.model = presetModel;

        const updatePresetSubtitle = (key) => { presetRow.subtitle = PRESETS[key]?.desc ?? ""; };
        let _suppressPresetDetect = false;

        const syncPresetRow = () => {
            const active = detectPreset(settings);
            settings.set_string("preset", active);
            const idx = PRESET_KEYS.indexOf(active);
            if (presetRow.selected !== idx) presetRow.selected = idx;
            updatePresetSubtitle(active);
        };

        const initKey = settings.get_string("preset");
        presetRow.selected = Math.max(PRESET_KEYS.indexOf(initKey), 0);
        updatePresetSubtitle(initKey);

        presetRow.connect("notify::selected", () => {
            const key = PRESET_KEYS[presetRow.selected];
            const p   = PRESETS[key];
            settings.set_string("preset", key);
            updatePresetSubtitle(key);
            if (key !== "custom") {
                _suppressPresetDetect = true;
                settings.set_double("inhale-duration",   p.inhale);
                settings.set_double("hold-in-duration",  p.holdIn);
                settings.set_double("exhale-duration",   p.exhale);
                settings.set_double("hold-out-duration", p.holdOut);
                _suppressPresetDetect = false;
            }
        });
        breathingGroup.add(presetRow);

        // ── Phase Durations ───────────────────────────────────────────────────
        const durGroup = new Adw.PreferencesGroup({
            title: "Phase Durations",
            description: "Seconds for each phase. Set hold phases to 0 to skip them.",
        });
        page.add(durGroup);

        const durDefs = [
            { key: "inhale-duration",   title: "Inhale",              subtitle: "Breathing in",                       min: 0.5 },
            { key: "hold-in-duration",  title: "Hold (after inhale)", subtitle: "Pause at full lungs — 0 to skip",   min: 0.0 },
            { key: "exhale-duration",   title: "Exhale",              subtitle: "Breathing out",                      min: 0.5 },
            { key: "hold-out-duration", title: "Hold (after exhale)", subtitle: "Pause at empty lungs — 0 to skip",  min: 0.0 },
        ];
        for (const { key, title, subtitle, min } of durDefs) {
            const adj = new Gtk.Adjustment({ lower: min, upper: 60.0, step_increment: 0.5, page_increment: 1.0, value: settings.get_double(key) });
            const row = new Adw.SpinRow({ title, subtitle, adjustment: adj, digits: 1 });
            adj.connect("value-changed", () => {
                const v = adj.value;
                if (Math.abs(v - settings.get_double(key)) > 0.001) settings.set_double(key, v);
            });
            settings.connect(`changed::${key}`, () => {
                const v = settings.get_double(key);
                if (Math.abs(v - adj.value) > 0.001) adj.set_value(v);
                if (!_suppressPresetDetect) syncPresetRow();
            });
            durGroup.add(row);
        }

        // ── Appearance ────────────────────────────────────────────────────────
        const appearGroup = new Adw.PreferencesGroup({ title: "Appearance" });
        page.add(appearGroup);

        const posRow = new Adw.ComboRow({ title: "Screen Edge" });
        const posLabels = ["Top", "Bottom", "Left", "Right"];
        const posValues = ["top", "bottom", "left", "right"];
        const posModel  = new Gtk.StringList();
        posLabels.forEach(l => posModel.append(l));
        posRow.model    = posModel;
        posRow.selected = Math.max(posValues.indexOf(settings.get_string("bar-position")), 0);
        posRow.connect("notify::selected", () => settings.set_string("bar-position", posValues[posRow.selected]));
        settings.connect("changed::bar-position", () => {
            posRow.selected = Math.max(posValues.indexOf(settings.get_string("bar-position")), 0);
        });
        appearGroup.add(posRow);

        appearGroup.add(intSpinRow(settings, "bar-thickness", "Thickness", "Bar height/width in pixels", 2, 60));

        const opacityAdj = new Gtk.Adjustment({ lower: 0.05, upper: 1.0, step_increment: 0.05, page_increment: 0.1, value: settings.get_double("opacity") });
        const opacityRow = new Adw.SpinRow({ title: "Opacity", subtitle: "0.05 = nearly invisible, 1.0 = fully opaque", adjustment: opacityAdj, digits: 2 });
        opacityAdj.connect("value-changed", () => {
            const v = opacityAdj.value;
            if (Math.abs(v - settings.get_double("opacity")) > 0.001) settings.set_double("opacity", v);
        });
        settings.connect("changed::opacity", () => {
            const v = settings.get_double("opacity");
            if (Math.abs(v - opacityAdj.value) > 0.001) opacityAdj.set_value(v);
        });
        appearGroup.add(opacityRow);

        const crossfadeRow = new Adw.SwitchRow({ title: "Color Crossfade", subtitle: "Smoothly blend colors between phases" });
        settings.bind("color-crossfade", crossfadeRow, "active", Gio.SettingsBindFlags.DEFAULT);
        appearGroup.add(crossfadeRow);

        const pulseRow = new Adw.SwitchRow({ title: "Pulse on Hold", subtitle: "Gently oscillate bar opacity during hold phases" });
        settings.bind("pulse-on-hold", pulseRow, "active", Gio.SettingsBindFlags.DEFAULT);
        appearGroup.add(pulseRow);

        // ── Colors ────────────────────────────────────────────────────────────
        const colorGroup = new Adw.PreferencesGroup({ title: "Colors", description: "Bar color for each breathing phase" });
        page.add(colorGroup);

        const colorDefs   = [
            { key: "inhale-color", title: "Inhale", subtitle: "Filling up" },
            { key: "hold-color",   title: "Hold",   subtitle: "Both hold phases" },
            { key: "exhale-color", title: "Exhale", subtitle: "Emptying out" },
        ];
        const colorDialog = new Gtk.ColorDialog({ with_alpha: false, modal: true });
        for (const { key, title, subtitle } of colorDefs) {
            const row = new Adw.ActionRow({ title, subtitle });
            const btn = new Gtk.ColorDialogButton({ dialog: colorDialog, valign: Gtk.Align.CENTER });
            btn.rgba = hexToRgba(settings.get_string(key));
            btn.connect("notify::rgba", () => settings.set_string(key, rgbaToHex(btn.rgba)));
            settings.connect(`changed::${key}`, () => {
                const hex = settings.get_string(key);
                if (hex.toLowerCase() !== rgbaToHex(btn.rgba).toLowerCase()) btn.rgba = hexToRgba(hex);
            });
            row.add_suffix(btn);
            row.set_activatable_widget(btn);
            colorGroup.add(row);
        }

        // ── Sound ─────────────────────────────────────────────────────────────
        const soundGroup = new Adw.PreferencesGroup({ title: "Sound" });
        page.add(soundGroup);

        const soundRow = new Adw.SwitchRow({
            title: "Phase Transition Sound",
            subtitle: "Play a bell tone at each phase change",
        });
        settings.bind("sound-enabled", soundRow, "active", Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(soundRow);

        // ── Session ───────────────────────────────────────────────────────────
        const sessionGroup = new Adw.PreferencesGroup({
            title: "Guided Session",
            description: "Full-screen focused breathing session. Start from the panel button.",
        });
        page.add(sessionGroup);

        const modeRow = new Adw.ComboRow({ title: "End Session By" });
        const modeModel = new Gtk.StringList();
        modeModel.append("Duration");
        modeModel.append("Cycle Count");
        modeRow.model = modeModel;
        const modeValues = ["duration", "cycles"];
        modeRow.selected = Math.max(modeValues.indexOf(settings.get_string("session-end-mode")), 0);
        modeRow.connect("notify::selected", () =>
            settings.set_string("session-end-mode", modeValues[modeRow.selected]));
        settings.connect("changed::session-end-mode", () => {
            modeRow.selected = Math.max(modeValues.indexOf(settings.get_string("session-end-mode")), 0);
        });
        sessionGroup.add(modeRow);

        const sessionDurRow = intSpinRow(settings, "session-duration",
            "Duration", "Minutes per guided session", 1, 60);
        sessionDurRow.set_sensitive(settings.get_string("session-end-mode") !== "cycles");
        sessionGroup.add(sessionDurRow);

        const sessionCyclesRow = intSpinRow(settings, "session-cycles",
            "Cycle Count", "Number of breath cycles per guided session", 1, 100);
        sessionCyclesRow.set_sensitive(settings.get_string("session-end-mode") === "cycles");
        sessionGroup.add(sessionCyclesRow);

        settings.connect("changed::session-end-mode", () => {
            const cycles = settings.get_string("session-end-mode") === "cycles";
            sessionDurRow.set_sensitive(!cycles);
            sessionCyclesRow.set_sensitive(cycles);
        });

        // ── Idle Auto-Start ───────────────────────────────────────────────────
        const idleGroup = new Adw.PreferencesGroup({
            title: "Idle Auto-Start",
            description: "Automatically show breathing bar when you stop using the computer",
        });
        page.add(idleGroup);

        const idleEnableRow = new Adw.SwitchRow({ title: "Enable Idle Auto-Start" });
        settings.bind("idle-auto-start", idleEnableRow, "active", Gio.SettingsBindFlags.DEFAULT);
        idleGroup.add(idleEnableRow);

        const idleDurRow = intSpinRow(settings, "idle-duration",
            "Idle Threshold", "Minutes of inactivity before bar appears", 1, 60);
        idleDurRow.set_sensitive(settings.get_boolean("idle-auto-start"));
        settings.connect("changed::idle-auto-start", () =>
            idleDurRow.set_sensitive(settings.get_boolean("idle-auto-start"))
        );
        idleGroup.add(idleDurRow);

        // ── Monitor ───────────────────────────────────────────────────────────
        const monitorGroup = new Adw.PreferencesGroup({ title: "Monitor" });
        page.add(monitorGroup);

        monitorGroup.add(intSpinRow(settings, "monitor",
            "Monitor Index",
            "-2 = all monitors, -1 = primary, 0 / 1 / 2… = specific display",
            -2, 9));

        // ── Reset ─────────────────────────────────────────────────────────────
        const resetGroup = new Adw.PreferencesGroup();
        page.add(resetGroup);

        const resetBtn = new Adw.ButtonRow({
            title: "Reset to Defaults",
            start_icon_name: "edit-clear-symbolic",
            css_classes: ["destructive-action", "reset-btn"],
            height_request: 60,
        });
        const resetCss = new Gtk.CssProvider();
        resetCss.load_from_string(".reset-btn image { margin-right: 8px; }");
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), resetCss,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
        resetBtn.connect("activated", () => {
            for (const key of obj.list_keys())
                settings.reset(key);
        });
        resetGroup.add(resetBtn);

        // ── Disclaimer ────────────────────────────────────────────────────────
        const disclaimerGroup = new Adw.PreferencesGroup();
        page.add(disclaimerGroup);

        const disclaimerRow = new Adw.ActionRow({
            title: "Disclaimer",
            subtitle: "This extension is a general wellness tool, not a medical device. Consult a healthcare professional before use if you have any medical conditions.",
            css_classes: ["dim-label"],
        });
        disclaimerGroup.add(disclaimerRow);
    }
}
