// tv-dash — live oversight TUI, Bloomberg-terminal aesthetic.
//
// Layout (mirrors polymarket-pipeline/dashboard.py):
//
//   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
//   ┃  TV DASH   ICT 3-PILLAR LIVE OVERSIGHT       2026-05-20 18:43 ET   ┃
//   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
//   ╭─ PIPELINE STATUS ─╮  ╭─ BAR CLOSES ─────────────────────────────╮
//   │ Detector  ● RUN    │  │ Time   Bar         O      H      L     C │
//   │ Scan #    42       │  │ 18:43  1779…       7421   7423   7421   │
//   │ Phase     EHNTAM   │  │ ...                                       │
//   │ Next      NY PM    │  ╰───────────────────────────────────────────╯
//   │ ...                │  ╭─ SETUPS ─────────────────────────────────╮
//   ╰────────────────────╯  │ Time   Model  Side   Status   Rationale  │
//   ╭─ SESSION FILES ────╮  │ 18:30  MSS    long   confirm   ...        │
//   │ P1      bullish    │  │ ...                                       │
//   │ ...                │  ╰───────────────────────────────────────────╯
//   ╰────────────────────╯
//   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
//   ┃ > latest: bar_close C=7421.5  · Ctrl+C exit · LIVE | Signals: 3   ┃
//   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	refreshInterval = 2 * time.Second
	heartbeatPath   = "state/session/detector-heartbeat.json"
	lastAnalyzePath = "state/last-analyze.json"
	sessionBase     = "state/session"
)

// ── ET clock ──────────────────────────────────────────────────────────────

var etLocation *time.Location

func init() {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		etLocation = time.UTC
	} else {
		etLocation = loc
	}
}

func nowETDate() string  { return time.Now().In(etLocation).Format("2006-01-02") }
func nowETTime() string  { return time.Now().In(etLocation).Format("15:04:05") }
func nowETShort() string { return time.Now().In(etLocation).Format("15:04") }
func formatET(t time.Time) string { return t.In(etLocation).Format("15:04:05") }

// ── Disk types ────────────────────────────────────────────────────────────

type Heartbeat struct {
	PID           int    `json:"pid"`
	StartedAt     string `json:"started_at"`
	LastHeartbeat string `json:"last_heartbeat"`
	LastEventAt   string `json:"last_event_at"`
	LastBarTime   *int64 `json:"last_bar_time"`
	LastBarClose  *struct {
		Time  int64   `json:"time"`
		Close float64 `json:"close"`
		TF    string  `json:"tf"`
	} `json:"last_bar_close"`
	CurrentState string `json:"current_state"`
}

type SessionFromBundle struct {
	Phase                 string  `json:"phase"`
	MinutesIntoPhase      int     `json:"minutes_into_phase"`
	NextKillzoneLabel     *string `json:"next_killzone_label"`
	SecondsToNextKillzone *int    `json:"seconds_to_next_killzone"`
	TimestampET           string  `json:"timestamp_et"`
}

type AnalyzeBundle struct {
	Gates struct {
		Session SessionFromBundle `json:"session"`
	} `json:"gates"`
}

type BarClose struct {
	TF           string  `json:"tf"`
	Symbol       string  `json:"symbol"`
	BarOpenTime  int64   `json:"bar_open_time"`
	BarCloseTime int64   `json:"bar_close_time"`
	Open         float64 `json:"open"`
	High         float64 `json:"high"`
	Low          float64 `json:"low"`
	Close        float64 `json:"close"`
	Is5mClose    bool    `json:"is_5m_close"`
}

type Setup struct {
	TS        string `json:"ts"`
	BarTime   int64  `json:"bar_time"`
	TF        string `json:"tf"`
	Model     string `json:"model"`
	Status    string `json:"status"`
	Side      string `json:"side"`
	Rationale string `json:"rationale"`
}

type SessionFile struct {
	Label string
	Path  string
	Mtime time.Time
	Value string
}

type State struct {
	Heartbeat     *Heartbeat
	Bundle        *AnalyzeBundle
	BarCloses     []BarClose
	Files         []SessionFile
	Setups        []Setup
	JSONLCounts   map[string]int
	ActiveSession string
}

func readJSON[T any](path string) (*T, error) {
	b, err := os.ReadFile(path)
	if err != nil { return nil, err }
	var v T
	if err := json.Unmarshal(b, &v); err != nil { return nil, err }
	return &v, nil
}

func readJSONLines[T any](path string, lastN int) ([]T, int, error) {
	b, err := os.ReadFile(path)
	if err != nil { return nil, 0, err }
	rawLines := strings.Split(string(b), "\n")
	var lines []string
	for _, l := range rawLines {
		if strings.TrimSpace(l) != "" { lines = append(lines, l) }
	}
	total := len(lines)
	if lastN > 0 && lastN < total { lines = lines[total-lastN:] }
	out := make([]T, 0, len(lines))
	for _, l := range lines {
		var v T
		if err := json.Unmarshal([]byte(l), &v); err == nil { out = append(out, v) }
	}
	return out, total, nil
}

func readMdVerdict(path string) (string, time.Time) {
	st, err := os.Stat(path)
	if err != nil { return "", time.Time{} }
	mtime := st.ModTime()
	b, err := os.ReadFile(path)
	if err != nil { return "", mtime }
	for _, l := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(l)
		if !strings.HasPrefix(t, "- ") { continue }
		t = strings.TrimPrefix(t, "- ")
		colon := strings.Index(t, ":")
		if colon < 0 { continue }
		key := t[:colon]
		switch key {
		case "htf_bias", "ltf_bias", "pillar2", "verdict",
			"bias_direction_note", "htf_ltf_alignment":
			return strings.TrimSpace(t[colon+1:]), mtime
		}
	}
	return "", mtime
}

// sessionFromPhase maps a bundle phase to its session subfolder name.
func sessionFromPhase(phase string) string {
	switch {
	case strings.Contains(phase, "ny_am"):
		return "ny-am"
	case strings.Contains(phase, "ny_pm"):
		return "ny-pm"
	case strings.Contains(phase, "london"):
		return "london"
	}
	return ""
}

// activeSessionDir picks the session subfolder to display: the one the current
// phase maps to, else (inter_session / closed / no bundle) the newest session
// folder that exists on disk.
func activeSessionDir(sessionDir, phase string) string {
	if s := sessionFromPhase(phase); s != "" {
		return s
	}
	for _, s := range []string{"ny-pm", "ny-am", "london"} {
		if fi, err := os.Stat(filepath.Join(sessionDir, s)); err == nil && fi.IsDir() {
			return s
		}
	}
	return ""
}

func loadState() State {
	dateKey := nowETDate()
	sessionDir := filepath.Join(sessionBase, dateKey)
	st := State{JSONLCounts: map[string]int{}}

	if hb, err := readJSON[Heartbeat](heartbeatPath); err == nil { st.Heartbeat = hb }
	if bundle, err := readJSON[AnalyzeBundle](lastAnalyzePath); err == nil { st.Bundle = bundle }

	phase := ""
	if st.Bundle != nil { phase = st.Bundle.Gates.Session.Phase }
	st.ActiveSession = activeSessionDir(sessionDir, phase)
	activeDir := sessionDir
	if st.ActiveSession != "" {
		activeDir = filepath.Join(sessionDir, st.ActiveSession)
	}

	// bar-close-events.jsonl is day-level (detector output).
	if events, total, err := readJSONLines[BarClose](filepath.Join(sessionDir, "bar-close-events.jsonl"), 60); err == nil {
		st.BarCloses = events
		st.JSONLCounts["bar-close-events.jsonl"] = total
	}
	// setups.jsonl and bars*.jsonl are session-scoped.
	if setups, total, err := readJSONLines[Setup](filepath.Join(activeDir, "setups.jsonl"), 30); err == nil {
		st.Setups = setups
		st.JSONLCounts["setups.jsonl"] = total
	}
	for _, name := range []string{"bars.jsonl", "bars-5m.jsonl"} {
		if _, total, err := readJSONLines[map[string]any](filepath.Join(activeDir, name), 1); err == nil {
			st.JSONLCounts[name] = total
		}
	}

	mdFiles := []struct{ name, label string }{
		{"pillar1.md", "P1"}, {"pillar2.md", "P2"},
		{"open-reaction.md", "open-rxn"}, {"ltf-bias.md", "ltf-bias"},
		{"summary.md", "summary"},
	}
	for _, mf := range mdFiles {
		p := filepath.Join(activeDir, mf.name)
		if _, err := os.Stat(p); err != nil { continue }
		v, m := readMdVerdict(p)
		st.Files = append(st.Files, SessionFile{Label: mf.label, Path: p, Mtime: m, Value: v})
	}
	return st
}

func ageStr(iso string) string {
	if iso == "" { return "—" }
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil { return "—" }
	s := int(time.Since(t).Seconds())
	if s < 60 { return fmt.Sprintf("%ds", s) }
	if s < 3600 { return fmt.Sprintf("%dm%ds", s/60, s%60) }
	return fmt.Sprintf("%dh%dm", s/3600, (s%3600)/60)
}

// ── Bloomberg-terminal palette (trader green/yellow/red, dim white) ──────

var (
	colAccent = lipgloss.Color("10")  // bright_green
	colWin    = lipgloss.Color("10")  // bright_green
	colWarn   = lipgloss.Color("11")  // yellow
	colLoss   = lipgloss.Color("9")   // bright_red
	colMagenta= lipgloss.Color("13")  // bright_magenta
	colMuted  = lipgloss.Color("7")   // light gray
	colDim    = lipgloss.Color("8")   // bright_black / gray
	colCyan   = lipgloss.Color("14")  // bright_cyan
	colFg     = lipgloss.Color("15")  // white

	sFg     = lipgloss.NewStyle().Foreground(colFg)
	sMuted  = lipgloss.NewStyle().Foreground(colMuted)
	sDim    = lipgloss.NewStyle().Foreground(colDim)
	sAccent = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	sWin    = lipgloss.NewStyle().Foreground(colWin).Bold(true)
	sWarn   = lipgloss.NewStyle().Foreground(colWarn).Bold(true)
	sLoss   = lipgloss.NewStyle().Foreground(colLoss).Bold(true)
	sBold   = lipgloss.NewStyle().Bold(true)
	sCyan   = lipgloss.NewStyle().Foreground(colCyan)
)

func valueStyle(value string) lipgloss.Style {
	v := strings.ToLower(value)
	switch {
	case strings.Contains(v, "bull"), v == "good", v == "ready", v == "confirmed", v == "aligned":
		return sWin
	case strings.Contains(v, "bear"), v == "poor", v == "invalidated", v == "stand_aside", v == "divergent":
		return sLoss
	case v == "marginal", v == "mixed", v == "pending", v == "candidate", v == "waiting", v == "unclear":
		return sWarn
	}
	return sFg
}

func phaseStyle(phase string) lipgloss.Style {
	switch {
	case strings.HasPrefix(phase, "entry_hunt"):    return sWin
	case strings.HasPrefix(phase, "open_reaction"): return sWarn
	case strings.HasPrefix(phase, "pre_session"), phase == "london_open":
		return sCyan.Bold(true)
	case strings.HasPrefix(phase, "post_"), phase == "inter_session":
		return sDim
	case phase == "closed": return sLoss
	}
	return sFg.Bold(true)
}

// ── Pane primitives ───────────────────────────────────────────────────────

// HEAVY border for header/footer (Bloomberg-y).
type heavyPane struct {
	outerW  int
	content string
}

func (p heavyPane) render() string {
	bodyW := p.outerW - 2
	if bodyW < 4 { return "" }
	bColor := lipgloss.NewStyle().Foreground(colAccent)

	top := bColor.Render("┏" + strings.Repeat("━", bodyW) + "┓")
	bottom := bColor.Render("┗" + strings.Repeat("━", bodyW) + "┛")
	// Center / pad content to body width
	contentW := lipgloss.Width(p.content)
	pad := bodyW - 2 - contentW
	if pad < 0 { pad = 0 }
	body := bColor.Render("┃") + " " + p.content + strings.Repeat(" ", pad) + " " + bColor.Render("┃")
	return top + "\n" + body + "\n" + bottom
}

// ROUNDED border for body sections (status, scanner, etc.).
type roundPane struct {
	title     string
	subtitle  string
	outerW    int
	outerH    int
	borderCol lipgloss.Color
	content   []string
}

func (p roundPane) renderTopBorder() string {
	if p.outerW < 6 { return "" }
	bColor := lipgloss.NewStyle().Foreground(p.borderCol)
	titleStr := " " + p.title + " "
	titleStyled := lipgloss.NewStyle().Foreground(p.borderCol).Bold(true).Render(titleStr)
	subStyled := ""
	if p.subtitle != "" {
		subStyled = sMuted.Render(p.subtitle + " ")
	}
	leftPiece := bColor.Render("╭─") + titleStyled
	if subStyled != "" { leftPiece += subStyled }
	totalW := lipgloss.Width(bColor.Render("╭─")) + lipgloss.Width(titleStyled) + lipgloss.Width(subStyled)
	rightFillN := p.outerW - totalW - 1
	if rightFillN < 1 { rightFillN = 1 }
	return leftPiece + bColor.Render(strings.Repeat("─", rightFillN)+"╮")
}
func (p roundPane) renderBottomBorder() string {
	bColor := lipgloss.NewStyle().Foreground(p.borderCol)
	return bColor.Render("╰" + strings.Repeat("─", p.outerW-2) + "╯")
}

func (p roundPane) render() string {
	bodyW := p.outerW - 2
	bodyH := p.outerH - 2
	if bodyH < 1 || bodyW < 4 { return "" }

	bColor := lipgloss.NewStyle().Foreground(p.borderCol)
	leftV := bColor.Render("│")
	rightV := bColor.Render("│")

	rows := make([]string, 0, bodyH)
	for i, ln := range p.content {
		if i >= bodyH { break }
		clipped := truncateANSI(ln, bodyW-2)
		rows = append(rows, clipped)
	}
	for len(rows) < bodyH { rows = append(rows, "") }

	var out strings.Builder
	out.WriteString(p.renderTopBorder())
	out.WriteString("\n")
	for _, r := range rows {
		pad := bodyW - 2 - lipgloss.Width(r)
		if pad < 0 { pad = 0 }
		out.WriteString(leftV + " " + r + strings.Repeat(" ", pad) + " " + rightV + "\n")
	}
	out.WriteString(p.renderBottomBorder())
	return out.String()
}

func truncateANSI(s string, max int) string {
	if lipgloss.Width(s) <= max { return s }
	return lipgloss.NewStyle().MaxWidth(max).Render(s)
}

// wrapPlain word-wraps raw (unstyled) text to width on word boundaries,
// measuring with lipgloss.Width so wrapped lines stay consistent with the
// pane's width math. A single word longer than width is left whole (rare).
func wrapPlain(text string, width int) []string {
	if width < 1 {
		width = 1
	}
	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{""}
	}
	lines := []string{}
	cur := words[0]
	for _, w := range words[1:] {
		if lipgloss.Width(cur+" "+w) <= width {
			cur += " " + w
		} else {
			lines = append(lines, cur)
			cur = w
		}
	}
	return append(lines, cur)
}

// ── Model ─────────────────────────────────────────────────────────────────

type tickMsg time.Time
type stateMsg State

func tickCmd() tea.Cmd {
	return tea.Tick(refreshInterval, func(t time.Time) tea.Msg { return tickMsg(t) })
}
func loadStateCmd() tea.Cmd { return func() tea.Msg { return stateMsg(loadState()) } }

type model struct {
	width, height int
	tick          int
	state         State
	ready         bool
	selectedFile  int
	viewMode      string // "default" | "file"
}

func (m model) Init() tea.Cmd { return tea.Batch(tickCmd(), loadStateCmd()) }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.ready = true
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c": return m, tea.Quit
		case "esc":
			if m.viewMode == "file" { m.viewMode = "default"; return m, nil }
			return m, tea.Quit
		case "up", "k":
			if m.selectedFile > 0 { m.selectedFile-- }
		case "down", "j":
			if m.selectedFile < len(m.state.Files)-1 { m.selectedFile++ }
		case "enter":
			if len(m.state.Files) > 0 { m.viewMode = "file" }
		}
	case tickMsg:
		m.tick++
		return m, tea.Batch(tickCmd(), loadStateCmd())
	case stateMsg:
		m.state = State(msg)
		if m.selectedFile >= len(m.state.Files) {
			m.selectedFile = len(m.state.Files) - 1
			if m.selectedFile < 0 { m.selectedFile = 0 }
		}
	}
	return m, nil
}

// ── Section content ───────────────────────────────────────────────────────

// Two-column label/value row, polymarket-pipeline style.
func kv(label, value string, valStyle lipgloss.Style) string {
	return fmt.Sprintf("%-16s %s", sMuted.Render(label), valStyle.Render(value))
}
func kvPlain(label, value string) string {
	return fmt.Sprintf("%-16s %s", sMuted.Render(label), sFg.Render(value))
}

func (m model) pipelineStatusLines() []string {
	hb := m.state.Heartbeat
	var detectorVal string
	var detectorStyle lipgloss.Style
	if hb == nil {
		detectorVal = "○ NOT RUNNING"
		detectorStyle = sLoss
	} else {
		hbTime, _ := time.Parse(time.RFC3339Nano, hb.LastHeartbeat)
		stale := time.Since(hbTime) > 70*time.Second
		if stale {
			detectorVal = "● STALE  " + ageStr(hb.LastHeartbeat)
			detectorStyle = sLoss
		} else {
			switch hb.CurrentState {
			case "polling_for_close":
				detectorVal = "◌ POLLING"
				detectorStyle = sWarn
			case "emitted":
				detectorVal = "● ACTIVE   " + ageStr(hb.LastHeartbeat)
				detectorStyle = sWin
			default:
				detectorVal = "● " + strings.ToUpper(hb.CurrentState)
				detectorStyle = sAccent
			}
		}
	}

	phase := "—"
	minStr := "—"
	nextKz := "—"
	if m.state.Bundle != nil {
		s := m.state.Bundle.Gates.Session
		phase = strings.ToUpper(s.Phase)
		minStr = fmt.Sprintf("+%dm", s.MinutesIntoPhase)
		if s.NextKillzoneLabel != nil && s.SecondsToNextKillzone != nil {
			sec := *s.SecondsToNextKillzone
			h := sec / 3600
			mm := (sec % 3600) / 60
			if h > 0 {
				nextKz = fmt.Sprintf("%s  %dh %dm", *s.NextKillzoneLabel, h, mm)
			} else {
				nextKz = fmt.Sprintf("%s  %dm", *s.NextKillzoneLabel, mm)
			}
		}
	}

	pid := "—"
	state := "—"
	lastEmit := "—"
	if hb != nil {
		pid = fmt.Sprintf("%d", hb.PID)
		state = hb.CurrentState
		if hb.LastBarClose != nil {
			lastEmit = fmt.Sprintf("C=%g  %s ago", hb.LastBarClose.Close, ageStr(hb.LastEventAt))
		}
	}

	return []string{
		kv("Detector", detectorVal, detectorStyle),
		kvPlain("PID", pid),
		kv("State", state, sDim),
		"",
		kv("Phase", phase, phaseStyle(strings.ToLower(phase))),
		kv("Minutes In", minStr, sWarn),
		kv("Next Killzone", nextKz, sAccent),
		"",
		kv("Last Emit", lastEmit, sCyan),
	}
}

func (m model) performanceLines() []string {
	totalBars := m.state.JSONLCounts["bar-close-events.jsonl"]
	totalSetups := m.state.JSONLCounts["setups.jsonl"]
	fiveMin := 0
	for _, e := range m.state.BarCloses {
		if e.Is5mClose { fiveMin++ }
	}

	confirmed, waiting, invalidated, other := 0, 0, 0, 0
	var firstConfirmedTS, lastConfirmedTS time.Time
	for _, s := range m.state.Setups {
		switch strings.ToLower(s.Status) {
		case "confirmed":
			confirmed++
			t, _ := time.Parse(time.RFC3339Nano, s.TS)
			if !t.IsZero() {
				if firstConfirmedTS.IsZero() || t.Before(firstConfirmedTS) { firstConfirmedTS = t }
				if t.After(lastConfirmedTS) { lastConfirmedTS = t }
			}
		case "candidate", "waiting":     waiting++
		case "invalidated":              invalidated++
		default:                          other++
		}
	}

	confirmationRate := "—"
	if totalSetups > 0 {
		confirmationRate = fmt.Sprintf("%d%%", confirmed*100/totalSetups)
	}

	// Most recent setup summary
	mostRecent := "—"
	if len(m.state.Setups) > 0 {
		s := m.state.Setups[len(m.state.Setups)-1]
		mostRecent = fmt.Sprintf("%s %s · %s", s.Model, s.Side, s.Status)
	}

	return []string{
		kvPlain("Bar Closes", fmt.Sprintf("%d  (%d 5m)", totalBars, fiveMin)),
		kvPlain("Setups Total", fmt.Sprintf("%d", totalSetups)),
		"",
		kv("Confirmed",   fmt.Sprintf("%d", confirmed),   sWin),
		kv("Waiting",     fmt.Sprintf("%d", waiting),     sWarn),
		kv("Invalidated", fmt.Sprintf("%d", invalidated), sLoss),
		func() string {
			if other > 0 { return kv("Other", fmt.Sprintf("%d", other), sDim) }
			return ""
		}(),
		"",
		kv("Confirm Rate", confirmationRate, sAccent),
		kv("Most Recent",  mostRecent,       valueStyle(extractStatus(mostRecent))),
	}
}

func extractStatus(s string) string {
	// pull trailing "· status" from "MSS long · confirmed"
	if i := strings.LastIndex(s, "· "); i >= 0 { return strings.TrimSpace(s[i+2:]) }
	return s
}

func (m model) sessionFilesLines() []string {
	files := m.state.Files
	sort.SliceStable(files, func(i, j int) bool { return files[i].Mtime.Before(files[j].Mtime) })
	out := []string{}
	if len(files) == 0 {
		out = append(out,
			sDim.Render("Waiting for /analyze..."),
			"",
			sDim.Render("Files appear when grades"),
			sDim.Render("are written.  Use j/k to"),
			sDim.Render("select, Enter to view."),
		)
	} else {
		for i, f := range files {
			marker := " "
			label := sBold.Render(fmt.Sprintf("%-9s", f.Label))
			if i == m.selectedFile && m.viewMode == "default" {
				marker = sAccent.Render("▸")
				label = lipgloss.NewStyle().Background(colDim).Foreground(colFg).Bold(true).Render(fmt.Sprintf("%-9s", f.Label))
			}
			val := sDim.Render("—")
			if f.Value != "" {
				val = valueStyle(f.Value).Render(f.Value)
			}
			out = append(out, fmt.Sprintf("%s %s %s", marker, label, val))
		}
		out = append(out, "")
		out = append(out, sMuted.Render("Counts:"))
		for _, name := range []string{"bars.jsonl", "bars-5m.jsonl", "setups.jsonl", "bar-close-events.jsonl"} {
			if c, ok := m.state.JSONLCounts[name]; ok && c > 0 {
				out = append(out, fmt.Sprintf("  %s %s", sBold.Render(name), sMuted.Render(fmt.Sprintf("%d", c))))
			}
		}
	}
	return out
}

// Polymarket-style table column with header rule.
func tableHeader(cols []string, widths []int) string {
	var rowB, ruleB strings.Builder
	for i, c := range cols {
		w := widths[i]
		s := c
		if len(s) > w { s = s[:w] }
		rowB.WriteString(sMuted.Render(fmt.Sprintf("%-*s", w, s)))
		ruleB.WriteString(sDim.Render(strings.Repeat("─", w)))
		if i < len(cols)-1 {
			rowB.WriteString(" ")
			ruleB.WriteString(" ")
		}
	}
	return rowB.String() + "\n" + ruleB.String()
}

func (m model) barClosesLines() []string {
	cols := []string{"Time", "Bar", "Open", "High", "Low", "Close", "TF"}
	widths := []int{8, 11, 7, 7, 7, 7, 4}
	header := tableHeader(cols, widths)
	lines := strings.Split(header, "\n")

	if len(m.state.BarCloses) == 0 {
		lines = append(lines, "", sDim.Render("Waiting for first bar close..."))
		return lines
	}

	// Newest first
	for i := len(m.state.BarCloses) - 1; i >= 0; i-- {
		e := m.state.BarCloses[i]
		t := time.Unix(e.BarCloseTime, 0).In(etLocation).Format("15:04:05")
		barNum := fmt.Sprintf("%d", e.BarCloseTime)
		if len(barNum) > 11 { barNum = barNum[len(barNum)-11:] }

		closeStyle := sBold
		if i > 0 {
			prev := m.state.BarCloses[i-1].Close
			if e.Close > prev { closeStyle = sWin }
			if e.Close < prev { closeStyle = sLoss }
		}

		row := fmt.Sprintf("%-*s %-*s %-*s %-*s %-*s %s %-*s",
			widths[0], sCyan.Render(t),
			widths[1], sDim.Render(barNum),
			widths[2], fmt.Sprintf("%g", e.Open),
			widths[3], fmt.Sprintf("%g", e.High),
			widths[4], fmt.Sprintf("%g", e.Low),
			closeStyle.Render(fmt.Sprintf("%-*g", widths[5], e.Close)),
			widths[6], e.TF,
		)
		if e.Is5mClose {
			row += "  " + sMagenta().Render("[5m]")
		}
		lines = append(lines, row)
	}
	return lines
}

func sMagenta() lipgloss.Style { return lipgloss.NewStyle().Foreground(colMagenta).Bold(true) }

func (m model) setupsLines() []string {
	cols := []string{"Time", "Model", "Side", "Status", "Rationale"}
	widths := []int{8, 9, 5, 11, 0}
	header := tableHeader(cols[:4], widths[:4])
	lines := strings.Split(header, "\n")
	// Add "Rationale" column header manually (no width clip)
	lines[0] += " " + sMuted.Render("Rationale")

	if len(m.state.Setups) == 0 {
		lines = append(lines, "", sDim.Render("No setups flagged yet."))
		lines = append(lines, sDim.Render("/analyze writes setups during entry_hunt phase."))
		return lines
	}

	// Newest first
	for i := len(m.state.Setups) - 1; i >= 0; i-- {
		s := m.state.Setups[i]
		t, _ := time.Parse(time.RFC3339Nano, s.TS)
		ts := "—"
		if !t.IsZero() { ts = formatET(t) }
		sideStyle := sFg
		if s.Side == "long"  { sideStyle = sWin }
		if s.Side == "short" { sideStyle = sLoss }
		statusStyle := valueStyle(s.Status)

		rationale := s.Rationale
		if len(rationale) > 50 { rationale = rationale[:50] + "…" }

		row := fmt.Sprintf("%-*s %-*s %s %s %s",
			widths[0], sCyan.Render(ts),
			widths[1], sBold.Render(s.Model),
			sideStyle.Render(fmt.Sprintf("%-*s", widths[2], s.Side)),
			statusStyle.Render(fmt.Sprintf("%-*s", widths[3], s.Status)),
			sDim.Render(rationale),
		)
		lines = append(lines, row)
	}
	return lines
}

// File-view mode: render selected MD file's content.
func (m model) fileContentLines() []string {
	if m.selectedFile < 0 || m.selectedFile >= len(m.state.Files) {
		return []string{sDim.Render("(no file selected)")}
	}
	f := m.state.Files[m.selectedFile]
	b, err := os.ReadFile(f.Path)
	if err != nil {
		return []string{sLoss.Render(fmt.Sprintf("error reading %s: %v", f.Path, err))}
	}
	// Wrap width = file pane inner content width (mirrors the layout math:
	// rightW-4, where rightW = width - leftW and leftW = width/3, min 28).
	leftW := m.width / 3
	if leftW < 28 {
		leftW = 28
	}
	wrapW := m.width - leftW - 4
	if wrapW < 20 {
		wrapW = 20
	}
	// wrapStyled word-wraps raw text to the pane width, then styles each
	// visual line. Manual wrap (measured with lipgloss.Width) — lipgloss's
	// own .Width() leaves lines that overflow by only a few cells unwrapped.
	wrapStyled := func(s lipgloss.Style, text string) []string {
		segs := wrapPlain(text, wrapW)
		styled := make([]string, len(segs))
		for i, seg := range segs {
			styled[i] = s.Render(seg)
		}
		return styled
	}
	out := []string{
		sAccent.Render(f.Path) + "   " + sMuted.Render("mod "+f.Mtime.In(etLocation).Format("15:04:05")),
		sDim.Render(strings.Repeat("─", 60)),
	}
	inFront := false
	for idx, ln := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(ln)
		switch {
		case idx == 0 && t == "---":
			inFront = true // opening frontmatter delimiter
			out = append(out, sMuted.Render(ln))
		case inFront && t == "---":
			inFront = false // closing frontmatter delimiter — frontmatter ends here
			out = append(out, sMuted.Render(ln))
		case inFront:
			out = append(out, sMuted.Render(ln))
		case t == "---":
			// a `---` after frontmatter is a horizontal rule, NOT a delimiter —
			// render it as a rule and do not re-enter frontmatter mode.
			out = append(out, sDim.Render(strings.Repeat("─", 60)))
		case strings.HasPrefix(t, "# "):
			out = append(out, wrapStyled(sAccent, ln)...)
		case strings.HasPrefix(t, "## "):
			out = append(out, wrapStyled(sCyan.Bold(true), ln)...)
		case strings.HasPrefix(t, "- "):
			if c := strings.Index(t, ":"); c > 0 {
				key := strings.TrimPrefix(t[:c], "- ")
				val := strings.TrimSpace(t[c+1:])
				full := fmt.Sprintf("- %s: %s", key, val)
				if lipgloss.Width(full) <= wrapW {
					out = append(out, fmt.Sprintf("- %s: %s", sBold.Render(key), valueStyle(val).Render(val)))
				} else {
					out = append(out, wrapStyled(sFg, full)...)
				}
				continue
			}
			out = append(out, wrapStyled(sFg, ln)...)
		default:
			if t == "" {
				out = append(out, ln)
			} else {
				out = append(out, wrapStyled(sFg, ln)...)
			}
		}
	}
	return out
}

// ── Header / Footer ───────────────────────────────────────────────────────

func (m model) headerContent() string {
	titleStyled := sAccent.Render(" TV DASH")
	subtitle := sMuted.Render("ICT 3-PILLAR LIVE OVERSIGHT")
	right := sMuted.Render(fmt.Sprintf("%s %s ET", nowETDate(), nowETTime()))
	// Distribute across the available width — we'll let the heavy pane
	// pad the right side.
	bodyW := m.width - 4 // border + inner padding
	titleW := lipgloss.Width(titleStyled)
	subW := lipgloss.Width(subtitle)
	rightW := lipgloss.Width(right)
	gap := bodyW - titleW - subW - rightW
	if gap < 2 { gap = 2 }
	leftGap := gap / 2
	rightGap := gap - leftGap
	return titleStyled + strings.Repeat(" ", leftGap) + subtitle + strings.Repeat(" ", rightGap) + right
}

func (m model) footerContent() string {
	headline := sDim.Render("Waiting for live data...")
	if m.state.Heartbeat != nil && m.state.Heartbeat.LastBarClose != nil {
		hb := m.state.Heartbeat.LastBarClose
		headline = fmt.Sprintf("%s %s  %s=%s  %s ago",
			sAccent.Render("▸"),
			sMuted.Render("latest:"),
			sBold.Render("close"),
			sFg.Render(fmt.Sprintf("%g", hb.Close)),
			sCyan.Render(ageStr(m.state.Heartbeat.LastEventAt)),
		)
	}
	keys := sDim.Render("j/k select · enter view · esc back · q quit")
	mode := sAccent.Render("LIVE")
	setupsCount := m.state.JSONLCounts["setups.jsonl"]
	signals := fmt.Sprintf("%s %s",
		sMuted.Render("Signals:"),
		sAccent.Render(fmt.Sprintf("%d", setupsCount)),
	)

	bodyW := m.width - 4
	leftW := lipgloss.Width(headline)
	midW := lipgloss.Width(keys)
	rightW := lipgloss.Width(mode) + 3 + lipgloss.Width(signals)
	gap := bodyW - leftW - midW - rightW
	if gap < 2 { gap = 2 }
	leftGap := gap / 2
	rightGap := gap - leftGap
	return headline + strings.Repeat(" ", leftGap) + keys + strings.Repeat(" ", rightGap) + mode + "   " + signals
}

// ── View ──────────────────────────────────────────────────────────────────

func (m model) View() string {
	if !m.ready { return "loading..." }

	// Heavy header (3 rows) + heavy footer (3 rows). Body = m.height - 6.
	headerH := 3
	footerH := 3
	bodyH := m.height - headerH - footerH
	if bodyH < 12 { bodyH = 12 }

	// Body split: left 1/3, right 2/3 (polymarket ratios).
	leftW := m.width / 3
	if leftW < 28 { leftW = 28 }
	rightW := m.width - leftW

	// Left column split: 3 stacked panes — STATUS, PERFORMANCE, FILES.
	// Slightly favors STATUS (most rows) then PERFORMANCE then FILES.
	statusH := bodyH * 36 / 100
	perfH := bodyH * 32 / 100
	filesH := bodyH - statusH - perfH
	if filesH < 6 {
		// reclaim from perf
		need := 6 - filesH
		perfH -= need
		filesH = 6
	}

	// Right column split: 2:3 → SCANNER (bar closes) top, TRADES (setups) bottom.
	scannerH := bodyH * 2 / 5
	if scannerH < 8 { scannerH = 8 }
	tradesH := bodyH - scannerH

	// In FILE view mode, the right side merges into one big file viewer.
	header := heavyPane{outerW: m.width, content: m.headerContent()}.render()
	footer := heavyPane{outerW: m.width, content: m.footerContent()}.render()

	statusPane := roundPane{
		title: "PIPELINE STATUS", outerW: leftW, outerH: statusH,
		borderCol: colAccent, content: m.pipelineStatusLines(),
	}.render()

	performancePane := roundPane{
		title: "PERFORMANCE", outerW: leftW, outerH: perfH,
		borderCol: colWarn, content: m.performanceLines(),
	}.render()

	sub := ""
	if m.state.ActiveSession != "" {
		sub = m.state.ActiveSession
		if c := len(m.state.Files); c > 0 {
			sub += fmt.Sprintf(" · %d", c)
		}
	} else if c := len(m.state.Files); c > 0 {
		sub = fmt.Sprintf("(%d)", c)
	}
	filesPane := roundPane{
		title: "SESSION FILES", subtitle: sub, outerW: leftW, outerH: filesH,
		borderCol: colCyan, content: m.sessionFilesLines(),
	}.render()

	var rightTop, rightBot string
	if m.viewMode == "file" && len(m.state.Files) > 0 {
		f := m.state.Files[m.selectedFile]
		rightTop = roundPane{
			title: "FILE  " + f.Label, outerW: rightW, outerH: bodyH,
			borderCol: colWarn, content: m.fileContentLines(),
		}.render()
		// rightBot empty (file viewer takes full right column)
	} else {
		scannerSub := ""
		if c := m.state.JSONLCounts["bar-close-events.jsonl"]; c > 0 {
			scannerSub = fmt.Sprintf("· %d today", c)
		}
		rightTop = roundPane{
			title: "BAR CLOSES",
			subtitle: scannerSub,
			outerW: rightW, outerH: scannerH,
			borderCol: colAccent, content: m.barClosesLines(),
		}.render()
		setupsSub := ""
		if c := m.state.JSONLCounts["setups.jsonl"]; c > 0 {
			setupsSub = fmt.Sprintf("· %d", c)
		}
		rightBot = roundPane{
			title: "SETUPS",
			subtitle: setupsSub,
			outerW: rightW, outerH: tradesH,
			borderCol: colCyan, content: m.setupsLines(),
		}.render()
	}

	leftCol := lipgloss.JoinVertical(lipgloss.Left, statusPane, performancePane, filesPane)
	var rightCol string
	if rightBot == "" {
		rightCol = rightTop
	} else {
		rightCol = lipgloss.JoinVertical(lipgloss.Left, rightTop, rightBot)
	}
	body := lipgloss.JoinHorizontal(lipgloss.Top, leftCol, rightCol)

	return lipgloss.JoinVertical(lipgloss.Left, header, body, footer)
}

// ── Utils ─────────────────────────────────────────────────────────────────

func progressBar(ratio float64, width int) string {
	if ratio < 0 { ratio = 0 }
	if ratio > 1 { ratio = 1 }
	filled := int(math.Round(ratio * float64(width)))
	return strings.Repeat("━", filled) + sDim.Render(strings.Repeat("━", width-filled))
}

func main() {
	p := tea.NewProgram(model{}, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "tv-dash error: %v\n", err)
		os.Exit(1)
	}
}
