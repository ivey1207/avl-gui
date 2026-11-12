import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, AreaChart, Area } from 'recharts';
import './App.css';
import Airplane3D from './Airplane3D';
import { apiFetch } from './api';

function App({ user, onLogout }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [avlContent, setAvlContent] = useState('');
  const [parsed, setParsed] = useState(null);
  const [alpha, setAlpha] = useState(0);
  const [beta, setBeta] = useState(0);
  const [xrefOverride, setXrefOverride] = useState(null);
  const [controls, setControls] = useState({});
  const [velocity, setVelocity] = useState(15.0);
  const [density, setDensity] = useState(1.225);
  const [mass, setMass] = useState(1.0);

  const [polarData, setPolarData] = useState(null);
  const [results, setResults] = useState(null);

  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState('3d');
  const [resultsTab, setResultsTab] = useState('forces');
  const requestInProgress = useRef(false);

  // Run cases
  const [runCases, setRunCases] = useState([]);
  const [showCases, setShowCases] = useState(false);

  useEffect(() => { fetchModels(); }, []);

  const fetchModels = async () => {
    try {
      const res = await apiFetch(`/api/models`);
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(data.models || []);
    } catch (e) { setError(e.message); }
  };

  const loadModel = async (filename) => {
    try {
      setLoading(true); setLoadingMsg('Loading model…'); setError(''); setResults(null);
      const res = await apiFetch(`/api/load/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error('Failed to load model');
      const data = await res.json();
      setAvlContent(data.content); setParsed(data.parsed); setSelectedModel(filename);
      setControls({});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setLoadingMsg(''); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setLoading(true); setLoadingMsg('Uploading…'); setError(''); setResults(null);
      const fd = new FormData(); fd.append('file', file);
      const res = await apiFetch(`/api/upload`, { method: 'POST', body: fd });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Upload failed'); }
      const data = await res.json();
      setAvlContent(data.content); setParsed(data.parsed); setSelectedModel(data.filename);
      fetchModels();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setLoadingMsg(''); }
  };

  const runSimulation = async (trim = "none") => {
    if (!parsed || requestInProgress.current) return;
    requestInProgress.current = true;
    setLoading(true);
    setLoadingMsg(trim === 'alpha' ? 'Trimming aircraft…' : 'Running AVL analysis…');
    setError(null);
    try {
      const response = await apiFetch(`/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avl_content: avlContent,
          alpha: parseFloat(alpha),
          beta: parseFloat(beta),
          xref_override: xrefOverride,
          controls: controls,
          trim_mode: trim
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Analysis failed');
      setResults(data);
      if (trim === "alpha" && data.alpha != null) {
        setAlpha(data.alpha.toFixed(2));
      }
      // Switch to load dist tab if we got strip data
      if (data.strips && data.strips.length > 0) {
        setResultsTab('forces');
      }
    } catch (err) { setError(err.message); }
    finally {
      setLoading(false);
      setLoadingMsg('');
      requestInProgress.current = false;
    }
  };

  const addCurrentAsCase = () => {
    if (!results) return;
    const label = `α=${results.alpha ?? alpha}° β=${beta}°`;
    setRunCases(prev => [...prev, {
      label,
      alpha: results.alpha ?? alpha,
      beta,
      CL: results.CL,
      CD: results.CD,
      Cm: results.Cm,
      Xnp: results.Xnp,
      e: results.e_oswald,
    }]);
  };

  const runPolarSweep = async (start = -5, end = 15, step = 1) => {
    if (!parsed || requestInProgress.current) return;
    requestInProgress.current = true;
    try {
      setLoading(true); setLoadingMsg('Calculating polar sweep…');
      const res = await apiFetch(`/api/run-polar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avl_content: avlContent,
          alpha_start: start,
          alpha_end: end,
          alpha_step: step,
          xref_override: xrefOverride,
          controls: controls
        }),
      });
      if (!res.ok) throw new Error('Polar sweep failed');
      const data = await res.json();
      setPolarData(data.data);
      // open AVL-style window
      openPolarWindow(data.data, mainWingStrips);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setLoadingMsg(''); requestInProgress.current = false; }
  };

  // ── Open polars in a real separate browser window (AVL Xplot style) ──
  const openPolarWindow = (data, strips = []) => {
    if (!data || data.length === 0) return;
    const name = parsed?.name || 'Aircraft';

    const stripsJSON = JSON.stringify(strips);
    const dataJSON = JSON.stringify(data);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AVL Polars — ${name}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080c18; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; padding: 24px; min-height: 100vh; }
    h1 { text-align: center; font-size: 1.3rem; color: #818cf8; margin-bottom: 6px; letter-spacing: 0.04em; }
    .subtitle { text-align: center; color: #475569; font-size: 0.82rem; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    .chart-box { background: #0f1729; border-radius: 14px; padding: 18px 16px 12px; border: 1px solid rgba(99,102,241,0.18); position: relative; }
    .chart-box h3 { text-align: center; font-size: 0.82rem; color: #64748b; margin-bottom: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
    canvas { display: block; }
    .ref-line { position: absolute; bottom: 18px; right: 16px; font-size: 0.7rem; color: #334155; }
  </style>
</head>
<body>
  <h1>✈ Aerodynamic Polars — ${name}</h1>
  <p class="subtitle">Athena Vortex Lattice · α sweep · Real AVL output</p>

  <div class="grid">
    <div class="chart-box"><h3>CL vs α — Lift Curve</h3><canvas id="c_cla"></canvas></div>
    <div class="chart-box"><h3>CD vs α — Drag Polar</h3><canvas id="c_cda"></canvas></div>
    <div class="chart-box"><h3>CL vs CD — Drag Bucket</h3><canvas id="c_clcd"></canvas></div>
    <div class="chart-box"><h3>Cm vs α — Pitch Stability</h3><canvas id="c_cma"></canvas></div>
    <div class="chart-box"><h3>L/D vs α — Efficiency</h3><canvas id="c_ld"></canvas></div>
    <div class="chart-box"><h3>Cl(y) — Spanwise Lift Dist.</h3><canvas id="c_span"></canvas></div>
  </div>

  <script>
    const raw = ${dataJSON};
    const strips = ${stripsJSON};

    const theme = {
      bg: 'transparent',
      grid: 'rgba(255,255,255,0.05)',
      tick: '#475569',
      legend: '#64748b',
    };

    const chartDefaults = (xlabel, ylabel) => ({
      responsive: true,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#e2e8f0',
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: xlabel, color: theme.tick, font: { size: 11 } },
          ticks: { color: theme.tick, font: { size: 10 } },
          grid: { color: theme.grid },
        },
        y: {
          title: { display: true, text: ylabel, color: theme.tick, font: { size: 11 } },
          ticks: { color: theme.tick, font: { size: 10 } },
          grid: { color: theme.grid },
        }
      }
    });

    // Helpers
    const pts = (xKey, yKey, fn) => raw.map(d => ({ x: fn ? fn(d) : d[xKey], y: d[yKey] }));

    // ── CL vs α ──
    new Chart('c_cla', {
      type: 'line',
      data: {
        datasets: [{
          label: 'CL', data: raw.map(d => ({ x: d.Alpha, y: d.CL })),
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)',
          pointRadius: 4, pointBackgroundColor: '#3b82f6', tension: 0.25, fill: true,
        }]
      },
      options: { ...chartDefaults('α (°)', 'CL') }
    });

    // ── CD vs α ──
    new Chart('c_cda', {
      type: 'line',
      data: {
        datasets: [{
          label: 'CD', data: raw.map(d => ({ x: d.Alpha, y: d.CD })),
          borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
          pointRadius: 4, pointBackgroundColor: '#ef4444', tension: 0.25, fill: true,
        }]
      },
      options: { ...chartDefaults('α (°)', 'CD') }
    });

    // ── CL vs CD (Drag Bucket) ──
    new Chart('c_clcd', {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'CL(CD)', data: raw.map(d => ({ x: d.CD, y: d.CL })),
          borderColor: '#8b5cf6', backgroundColor: '#8b5cf6',
          pointRadius: 4, showLine: true, tension: 0.2,
        }]
      },
      options: { ...chartDefaults('CD', 'CL') }
    });

    // ── Cm vs α ──
    new Chart('c_cma', {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cm', data: raw.map(d => ({ x: d.Alpha, y: d.Cm })),
          borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
          pointRadius: 4, pointBackgroundColor: '#10b981', tension: 0.25, fill: true,
        }]
      },
      options: {
        ...chartDefaults('α (°)', 'Cm'),
        plugins: {
          ...chartDefaults().plugins,
          annotation: {},
        }
      }
    });

    // ── L/D vs α ──
    new Chart('c_ld', {
      type: 'line',
      data: {
        datasets: [{
          label: 'L/D', data: raw.map(d => ({ x: d.Alpha, y: d.CD > 0.00001 ? d.CL / d.CD : null })),
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)',
          pointRadius: 4, pointBackgroundColor: '#f59e0b', tension: 0.25, fill: true,
          spanGaps: false,
        }]
      },
      options: { ...chartDefaults('α (°)', 'L/D') }
    });

    // ── Cl(y) spanwise distribution ──
    if (strips.length > 0) {
      const mirrorStrips = [...strips.map(s => ({ x: -s.Yle, y: s.cl })).reverse(), ...strips.map(s => ({ x: s.Yle, y: s.cl }))];
      new Chart('c_span', {
        type: 'line',
        data: {
          datasets: [{
            label: 'Cl(y)', data: mirrorStrips,
            borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.15)',
            pointRadius: 2, tension: 0.3, fill: true,
          }]
        },
        options: { ...chartDefaults('y (m)', 'Cl') }
      });
    } else {
      document.getElementById('c_span').parentElement.innerHTML =
        '<h3>Cl(y) — Spanwise Lift Dist.</h3><div style="color:#475569;text-align:center;padding:40px;font-size:0.85rem">Run Analysis first to see spanwise distribution</div>';
    }
  <\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'width=1400,height=820,scrollbars=yes,resizable=yes');
    if (!w) alert('Allow popups for this site to open the analysis window.');
    // Clean up blob URL after window loads
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };



  const handleControlChange = (ctrlName, val) => {
    setControls(prev => ({ ...prev, [ctrlName]: parseFloat(val) }));
  };

  const xnpStable = results?.Xnp != null && parsed?.Xref != null && results.Xnp > (xrefOverride ?? parsed.Xref);
  const cmaStable = results?.Cma != null && results.Cma < 0;
  const staticMargin = (results?.Xnp != null && parsed?.Xref != null && parsed?.Cref)
    ? ((results.Xnp - (xrefOverride ?? parsed.Xref)) / parsed.Cref * 100).toFixed(1) : null;

  let shortPeriod = null;
  let phugoid = null;
  let isDynamicallyStable = null;

  if (results && parsed?.Sref && parsed?.Cref) {
    const mu = mass / (density * parsed.Sref * parsed.Cref);
    if (results.Cma != null && results.CLa != null) {
      const wn_sp = Math.sqrt(Math.abs(results.Cma * results.CLa) / (2 * mu));
      const damping_sp = (results.Cmq != null && results.Cmad != null && wn_sp > 0)
        ? -(results.Cmq + results.Cmad) / (2 * wn_sp) : null;
      shortPeriod = { wn: wn_sp, zeta: damping_sp };
    }
    if (results.CL != null && results.CD != null && velocity > 0) {
      const g = 9.81;
      const wp_ph = Math.sqrt(2) * g / velocity;
      const damping_ph = (results.CL !== 0) ? results.CD / (Math.sqrt(2) * results.CL) : null;
      phugoid = { wp: wp_ph, period: (2 * Math.PI) / wp_ph, zeta: damping_ph };
    }
    if (shortPeriod?.zeta != null && phugoid?.zeta != null) {
      isDynamicallyStable = (shortPeriod.zeta > 0 && phugoid.zeta > 0);
    }
  }

  const displayParsed = parsed ? { ...parsed, Xref: xrefOverride != null ? xrefOverride : parsed.Xref } : null;

  // Flatten strip data for the main wing (first surface)
  const mainWingStrips = useMemo(() => {
    if (!results?.strips?.length) return [];
    const surf = results.strips[0];
    return surf?.strips || [];
  }, [results]);

  return (
    <div className="app-container">
      {loading && <div className="overlay"><div className="spinner"></div><span>{loadingMsg}</span></div>}

      <header className="glass-header">
        <div className="header-left">
          {/* ATRAK logo — inverted to white for dark header */}
          <img
            src="/atrak_logo.png"
            alt="ATRAK"
            style={{ height: '36px', width: 'auto', filter: 'invert(1) brightness(2)', marginRight: '12px', objectFit: 'contain' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.08em', color: '#f1f5f9' }}>
              ATRAK <span style={{ color: 'var(--accent)', fontWeight: 500, fontSize: '0.9rem', letterSpacing: '0.04em' }}>Vortex Lattice</span>
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.06em', fontWeight: 500 }}>
              Aerodynamic Analysis Simulator
            </span>
          </div>
        </div>
        <div className="header-right">
          <select value={selectedModel} onChange={(e) => { if (e.target.value) loadModel(e.target.value); }}>
            <option value="">— Select a model —</option>
            {models.map((m) => <option key={m} value={m}>{m.replace('.avl', '')}</option>)}
          </select>
          <label className="btn-upload-slim">
            📁 Upload .avl
            <input type="file" accept=".avl" onChange={handleFileUpload} hidden />
          </label>
          <div className="user-chip" title={`Signed in as ${user}`}>
            <span className="user-avatar">{user.charAt(0).toUpperCase()}</span>
            <span className="user-name">{user}</span>
          </div>
          <button type="button" className="btn-logout" onClick={onLogout}>Log out</button>
        </div>
      </header>


      <main className="content">
        {error && <p className="error" style={{ margin: '16px' }}>{error}</p>}

        {parsed ? (
          <div className="dashboard">
            {/* ── Column 1: Config (Left) ── */}
            <div className="left-panel">
              <section className="glass-panel">
                <h2>Flight Conditions</h2>

                <div className="slider-container" style={{ marginTop: '16px' }}>
                  <div className="slider-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Angle of Attack (α)</span>
                    <div>
                      <button className="btn-run" style={{ padding: '4px 8px', fontSize: '0.78rem', marginRight: '8px', background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={() => runSimulation('alpha')} disabled={loading}>
                        ✂️ Trim (Cm=0)
                      </button>
                      <span className="alpha-badge">{alpha}°</span>
                    </div>
                  </div>
                  <input type="range" min="-10" max="20" step="0.5" value={alpha} onChange={(e) => setAlpha(e.target.value)} />
                </div>

                <div className="slider-container" style={{ marginTop: '12px' }}>
                  <div className="slider-header">
                    <span>Sideslip (β)</span>
                    <span className="alpha-badge" style={{ background: 'var(--success)' }}>{beta}°</span>
                  </div>
                  <input type="range" min="-20" max="20" step="0.5" value={beta} onChange={(e) => setBeta(e.target.value)} />
                </div>

                <div className="slider-container" style={{ marginTop: '12px' }}>
                  <div className="slider-header">
                    <span>Center of Gravity (Xref)</span>
                    <span className="alpha-badge" style={{ background: '#ef4444' }}>{(xrefOverride ?? parsed.Xref ?? 0).toFixed(3)}m</span>
                  </div>
                  <input type="range" min={(parsed.Xref || 0) - 1} max={(parsed.Xref || 0) + 1} step="0.005"
                    value={xrefOverride ?? parsed.Xref ?? 0}
                    onChange={(e) => setXrefOverride(parseFloat(e.target.value))} />
                </div>

                {parsed.controls && parsed.controls.length > 0 && (
                  <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-muted)' }}>Control Surfaces</h3>
                    {parsed.controls.map(ctrl => (
                      <div className="slider-container" style={{ marginTop: '8px' }} key={ctrl}>
                        <div className="slider-header">
                          <span style={{ textTransform: 'capitalize' }}>{ctrl}</span>
                          <span className="alpha-badge" style={{ background: '#6366f1' }}>{controls[ctrl] || 0}°</span>
                        </div>
                        <input type="range" min="-30" max="30" step="0.5" value={controls[ctrl] || 0}
                          onChange={(e) => handleControlChange(ctrl, e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-muted)' }}>Dynamic Stability Parameters</h3>
                  <div className="slider-container" style={{ marginTop: '8px' }}>
                    <div className="slider-header"><span>Velocity V (m/s)</span><span className="alpha-badge">{velocity}</span></div>
                    <input type="range" min="1" max="100" step="0.5" value={velocity} onChange={(e) => setVelocity(parseFloat(e.target.value))} />
                  </div>
                  <div className="slider-container" style={{ marginTop: '8px' }}>
                    <div className="slider-header"><span>Density ρ (kg/m³)</span><span className="alpha-badge">{density}</span></div>
                    <input type="range" min="0.1" max="1.5" step="0.005" value={density} onChange={(e) => setDensity(parseFloat(e.target.value))} />
                  </div>
                  <div className="slider-container" style={{ marginTop: '8px' }}>
                    <div className="slider-header"><span>Mass m (kg)</span><span className="alpha-badge">{mass}</span></div>
                    <input type="range" min="0.1" max="50" step="0.1" value={mass} onChange={(e) => setMass(parseFloat(e.target.value))} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
                  <button className="btn-run" onClick={() => runSimulation('none')} disabled={loading}>
                    {loading ? '⏳ Calculating…' : '▶  Run Analysis'}
                  </button>

                  {/* Polar button — full width, no wrapping */}
                  <button className="btn-run" onClick={() => runPolarSweep(-5, 15, 1)} disabled={loading}
                    style={{ background: 'rgba(30,41,59,0.4)', border: '1px solid var(--border)', color: 'var(--text)', marginTop: 0, whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    📈 Polar Sweep
                  </button>

                  {/* Window + Save Case — only when data exists */}
                  {(polarData || results) && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {polarData && (
                        <button onClick={() => openPolarWindow(polarData, mainWingStrips)}
                          style={{ flex: 1, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.4)', color: '#06b6d4', borderRadius: '8px', padding: '7px 8px', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                          title="Open polars in new window">
                          ↗ Polars
                        </button>
                      )}
                      {results && (
                        <button onClick={addCurrentAsCase}
                          style={{ flex: 1, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8', borderRadius: '8px', padding: '7px 8px', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                          + Save Case
                        </button>
                      )}
                    </div>
                  )}

                  {runCases.length > 0 && (
                    <button onClick={() => setShowCases(true)}
                      style={{ background: 'transparent', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px', color: '#818cf8', padding: '6px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      📋 Compare {runCases.length} Cases
                    </button>
                  )}
                </div>


              </section>

              {/* Global Parameters */}
              <section className="glass-panel">
                <h2>Model Parameters</h2>
                <div className="plane-info">
                  <div className="info-row"><span className="info-label">Name</span><span className="info-value">{parsed.name}</span></div>
                  <div className="info-row"><span className="info-label">Mach</span><span className="info-value">{parsed.mach}</span></div>
                </div>
                <div className="params-grid" style={{ marginTop: '10px' }}>
                  <div className="param-item"><span className="param-label">Sref</span><span className="param-value">{parsed.Sref}</span><span className="param-unit">m²</span></div>
                  <div className="param-item"><span className="param-label">Cref</span><span className="param-value">{parsed.Cref}</span><span className="param-unit">m</span></div>
                  <div className="param-item"><span className="param-label">Bref</span><span className="param-value">{parsed.Bref}</span><span className="param-unit">m</span></div>
                </div>
              </section>

              {/* Surfaces */}
              <section className="glass-panel" style={{ flex: 1, minHeight: '200px' }}>
                <h2>Surfaces ({parsed.surfaces.length})</h2>
                <div className="surfaces-accordion">
                  {parsed.surfaces.map((surf, si) => (
                    <details key={si} className="surface-detail">
                      <summary className="surface-summary">
                        <span className="surface-name">{surf.name}</span>
                        <span className="surface-badge">{surf.sections.length} sections</span>
                      </summary>
                      <div className="surface-body">
                        <div className="params-grid">
                          <div className="param-item"><span className="param-label">Nchord</span><span className="param-value">{surf.nchord}</span></div>
                          <div className="param-item"><span className="param-label">Nspan</span><span className="param-value">{surf.nspan}</span></div>
                          {surf.yduplicate != null && <div className="param-item"><span className="param-label">Y-Dup</span><span className="param-value">{surf.yduplicate}</span></div>}
                          {surf.angle != null && <div className="param-item"><span className="param-label">Incid</span><span className="param-value">{surf.angle}°</span></div>}
                        </div>
                        <div className="sections-table-wrap">
                          <table className="sections-table">
                            <thead><tr><th>#</th><th>Xle</th><th>Yle</th><th>Chord</th><th>Ainc</th><th>Airfoil</th></tr></thead>
                            <tbody>
                              {surf.sections.map((sec, sei) => (
                                <tr key={sei}><td>{sei+1}</td><td>{sec.Xle}</td><td>{sec.Yle}</td><td>{sec.Chord}</td><td>{sec.Ainc}</td><td>{sec.afile||'—'}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            </div>

            {/* ── Column 2: 3D Studio (Center) ── */}
            <div className="central-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'rgba(10, 14, 26, 0.8)', borderBottom: '1px solid rgba(99, 102, 241, 0.2)' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '16px', background: 'var(--accent)', borderRadius: '2px' }}></span>
                  Geometry Studio
                </h2>
                <div className="control-btn-group" style={{ position: 'static' }}>
                  <button className={viewTab === '3d' ? 'active' : ''} onClick={() => setViewTab('3d')}>3D</button>
                  <button className={viewTab === '2d' ? 'active' : ''} onClick={() => setViewTab('2d')}>Top View</button>
                </div>
              </div>
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', height: 'calc(100% - 53px)' }}>
                <div style={{ display: viewTab === '3d' ? 'block' : 'none', height: '100%' }}>
                  <Airplane3D parsed={displayParsed} results={results} strips={mainWingStrips} />
                </div>
                <div style={{ display: viewTab === '2d' ? 'flex' : 'none', padding: '24px', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  {parsed && <PlanformSVG parsed={displayParsed} />}
                </div>
              </div>
            </div>

            {/* ── Column 3: Results (Right) ── */}
            <div className="right-panel">
              {results ? (
                <div className="results-section" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                  {/* Results tabs */}
                  <div style={{ display: 'flex', gap: '4px', padding: '12px 16px 0', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                    {[
                      ['forces', '⚡ Forces'],
                      ['stability', '🔒 Stability'],
                      ['loaddist', '📊 Load Dist'],
                      ['derivs', '∂ Derivatives'],
                      ['hinge', '🎛️ Controls'],
                    ].map(([key, label]) => (
                      <button key={key} onClick={() => setResultsTab(key)}
                        style={{
                          padding: '6px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                          background: resultsTab === key ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                          color: resultsTab === key ? '#fff' : 'var(--text-muted)',
                          cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap'
                        }}>{label}</button>
                    ))}
                  </div>

                  {/* ── FORCES TAB ── */}
                  {resultsTab === 'forces' && (
                    <section className="glass-panel">
                      <h2>Total Aerodynamic Forces</h2>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Model: <strong>{parsed.name}</strong> | α = {(results.alpha ?? alpha)}° | β = {beta}°
                      </p>
                      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        <MetricCard label="Lift CL" value={results.CL} decimals={4} accent="#3b82f6" />
                        <MetricCard label="Drag CD" value={results.CD} decimals={5} accent="#ef4444" />
                        <MetricCard label="Pitch Cm" value={results.Cm} decimals={4} accent="#f59e0b" />
                        <MetricCard label="Side CY" value={results.CYtot} decimals={5} accent="#8b5cf6" />
                        <MetricCard label="Roll Cl" value={results.Cltot} decimals={5} accent="#10b981" />
                        <MetricCard label="Yaw Cn" value={results.Cntot} decimals={5} accent="#ec4899" />
                        <MetricCard label="Induced CD" value={results.CDind} decimals={5} accent="#f97316" />
                        <MetricCard label="Oswald e" value={results.e_oswald} decimals={4} accent="#06b6d4" />
                        <MetricCard label="L/D" value={results.CL && results.CD ? results.CL / results.CD : null} decimals={2} accent="#84cc16" />
                        <MetricCard label="CLff" value={results.CLff} decimals={4} accent="#6366f1" />
                      </div>

                      {results.Xnp && (
                        <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(99,102,241,0.1)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.2)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Neutral Point Xnp</span>
                            <span style={{ color: '#818cf8', fontWeight: 700 }}>{results.Xnp.toFixed(4)} m</span>
                          </div>
                          {staticMargin != null && (
                            <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Static Margin</span>
                              <span style={{ color: xnpStable ? '#10b981' : '#ef4444', fontWeight: 700 }}>{staticMargin}% MAC {xnpStable ? '✅' : '❌'}</span>
                            </div>
                          )}
                          {results.spiral_stability != null && (
                            <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Spiral Stability</span>
                              <span style={{ color: results.spiral_stability > 1 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                                {results.spiral_stability.toFixed(4)} {results.spiral_stability > 1 ? '✅' : '⚠️'}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── STABILITY TAB ── */}
                  {resultsTab === 'stability' && (
                    <section className="glass-panel">
                      <h2>Stability Analysis</h2>
                      <div className="stability-grid">
                        <div className={`stability-card ${xnpStable ? 'stable' : 'unstable'}`}>
                          <div className="stab-title">Neutral Point Xnp</div>
                          <div className="stab-value">{results.Xnp != null ? results.Xnp.toFixed(4) : '—'} m</div>
                          <div className="stab-msg">
                            {staticMargin != null && <span>Margin: {staticMargin}% MAC<br/></span>}
                            {xnpStable ? '✅ Statically Stable' : '❌ Unstable — move CG forward'}
                          </div>
                        </div>
                        <div className={`stability-card ${cmaStable ? 'stable' : 'unstable'}`}>
                          <div className="stab-title">Pitch Stiffness Cmα</div>
                          <div className="stab-value">{results.Cma != null ? results.Cma.toFixed(4) : '—'}</div>
                          <div className="stab-msg">{cmaStable ? '✅ Self-correcting' : '❌ Pitch-divergent'}</div>
                        </div>
                        <div className={`stability-card ${isDynamicallyStable ? 'stable' : 'unstable'}`} style={{ gridColumn: 'span 2' }}>
                          <div className="stab-title">Dynamic Modes</div>
                          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                            <div style={{ flex: 1, background: 'var(--bg-lighter)', padding: '10px', borderRadius: '6px' }}>
                              <strong style={{ fontSize: '0.85rem', color: '#818cf8' }}>Short Period</strong><br/>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                                ωₙ = {shortPeriod?.wn != null ? shortPeriod.wn.toFixed(3) : '—'} rad/s<br/>
                                ζ = {shortPeriod?.zeta != null ? shortPeriod.zeta.toFixed(4) : '—'}<br/>
                                {shortPeriod?.zeta != null && (shortPeriod.zeta > 0 ? '✅ Damped' : '❌ Diverging')}
                              </span>
                            </div>
                            <div style={{ flex: 1, background: 'var(--bg-lighter)', padding: '10px', borderRadius: '6px' }}>
                              <strong style={{ fontSize: '0.85rem', color: '#10b981' }}>Phugoid</strong><br/>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                                Period = {phugoid?.period != null ? phugoid.period.toFixed(1) : '—'} s<br/>
                                ζ = {phugoid?.zeta != null ? phugoid.zeta.toFixed(4) : '—'}<br/>
                                {phugoid?.zeta != null && (phugoid.zeta > 0 ? '✅ Damped' : '❌ Diverging')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* ── LOAD DISTRIBUTION TAB ── */}
                  {resultsTab === 'loaddist' && (
                    <section className="glass-panel">
                      <h2>Spanwise Load Distribution</h2>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        Trefftz plane analysis — AVL strip forces along wingspan
                      </p>
                      {mainWingStrips.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                          {/* CL distribution */}
                          <div>
                            <h3 style={{ fontSize: '0.85rem', color: '#3b82f6', marginBottom: '8px' }}>Cl — Lift Coefficient vs Span</h3>
                            <ResponsiveContainer width="100%" height={180}>
                              <AreaChart data={mainWingStrips} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="Yle" stroke="rgba(255,255,255,0.4)" fontSize={11} tickFormatter={v => v.toFixed(2)} label={{ value: 'y (m)', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 11 }} />
                                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickFormatter={v => v.toFixed(3)} />
                                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: '0.78rem' }}
                                  formatter={(v, n) => [v?.toFixed(5), n]} labelFormatter={v => `y = ${parseFloat(v).toFixed(3)} m`} />
                                <Area type="monotone" dataKey="cl" stroke="#3b82f6" fill="rgba(59,130,246,0.15)" strokeWidth={2} dot={false} name="cl" />
                                <Area type="monotone" dataKey="cl_norm" stroke="#818cf8" fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="cl_norm" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Induced angle distribution */}
                          <div>
                            <h3 style={{ fontSize: '0.85rem', color: '#f59e0b', marginBottom: '8px' }}>αᵢ — Induced Angle vs Span</h3>
                            <ResponsiveContainer width="100%" height={150}>
                              <AreaChart data={mainWingStrips} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="Yle" stroke="rgba(255,255,255,0.4)" fontSize={11} tickFormatter={v => v.toFixed(2)} />
                                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickFormatter={v => v.toFixed(2)} />
                                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: '0.78rem' }}
                                  formatter={(v) => [v?.toFixed(4) + '°', 'αᵢ']} labelFormatter={v => `y = ${parseFloat(v).toFixed(3)} m`} />
                                <Area type="monotone" dataKey="ai" stroke="#f59e0b" fill="rgba(245,158,11,0.12)" strokeWidth={2} dot={false} name="αᵢ" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Strip table */}
                          <details style={{ marginTop: '4px' }}>
                            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', userSelect: 'none' }}>Show strip data table</summary>
                            <div className="sections-table-wrap" style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                              <table className="sections-table">
                                <thead><tr><th>j</th><th>Yle</th><th>Chord</th><th>cl</th><th>cd</th><th>αᵢ(°)</th><th>cm_c/4</th></tr></thead>
                                <tbody>
                                  {mainWingStrips.map((s, i) => (
                                    <tr key={i}>
                                      <td>{s.j}</td>
                                      <td>{s.Yle?.toFixed(3)}</td>
                                      <td>{s.Chord?.toFixed(3)}</td>
                                      <td style={{ color: '#3b82f6' }}>{s.cl?.toFixed(4)}</td>
                                      <td style={{ color: '#ef4444' }}>{s.cd?.toFixed(5)}</td>
                                      <td style={{ color: '#f59e0b' }}>{s.ai?.toFixed(3)}</td>
                                      <td>{s.cm_c4?.toFixed(4)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📊</div>
                          <p>Run Analysis first to see spanwise load distribution</p>
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── DERIVATIVES TAB ── */}
                  {resultsTab === 'derivs' && (
                    <section className="glass-panel">
                      <h2>Stability Derivatives</h2>
                      <div className="deriv-tables-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        <DerivTable title="α Derivatives" color="#3b82f6" items={[
                          ['CLα', results.CLa], ['CYα', results.CYa], ['Clα', results.Cla],
                          ['Cmα', results.Cma], ['Cnα', results.Cna],
                        ]} />
                        <DerivTable title="β Derivatives" color="#10b981" items={[
                          ['CLβ', results.CLb], ['CYβ', results.CYb], ['Clβ', results.Clb],
                          ['Cmβ', results.Cmb], ['Cnβ', results.Cnb],
                        ]} />
                        <DerivTable title="Roll Rate p̄" color="#f59e0b" items={[
                          ['CLp', results.CLp], ['CYp', results.CYp], ['Clp', results.Clp], ['Cnp', results.Cnp],
                        ]} />
                        <DerivTable title="Pitch Rate q̄" color="#8b5cf6" items={[
                          ['CLq', results.CLq], ['Cmq', results.Cmq],
                        ]} />
                        <DerivTable title="Yaw Rate r̄" color="#ec4899" items={[
                          ['CYr', results.CYr], ['Clr', results.Clr], ['Cnr', results.Cnr],
                        ]} />
                        <DerivTable title="α̇ Derivatives" color="#06b6d4" items={[
                          ['CLα̇', results.CLad], ['Cmα̇', results.Cmad],
                        ]} />
                      </div>
                      {results.control_derivs && Object.keys(results.control_derivs).length > 0 && (
                        <div style={{ marginTop: '16px' }}>
                          <h3 style={{ fontSize: '0.85rem', color: '#818cf8', marginBottom: '8px' }}>Control Derivatives</h3>
                          <div className="deriv-tables-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                            <DerivTable title="Surface Efficiencies" color="#6366f1" items={
                              Object.entries(results.control_derivs).map(([k, v]) => [k, v])
                            } />
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── CONTROLS/HINGE TAB ── */}
                  {resultsTab === 'hinge' && (
                    <section className="glass-panel">
                      <h2>Control Surface Moments</h2>
                      {results.hinge_moments && results.hinge_moments.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {results.hinge_moments.map((hm, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.15)' }}>
                              <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{hm.surface}</span>
                              <span style={{ fontFamily: 'monospace', color: Math.abs(hm.hinge_moment) < 1e-6 ? 'var(--text-muted)' : '#f59e0b', fontWeight: 700 }}>
                                {hm.hinge_moment?.toFixed(6)}
                              </span>
                            </div>
                          ))}
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                            Hinge moments referred to Sref × Cref
                          </p>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🎛️</div>
                          <p>No control surfaces found in this model, or run Analysis first.</p>
                        </div>
                      )}

                      {/* Control derivatives summary */}
                      {results.control_derivs && Object.keys(results.control_derivs).length > 0 && (
                        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                          <h3 style={{ fontSize: '0.85rem', marginBottom: '12px', color: 'var(--text-muted)' }}>Control Effectiveness</h3>
                          {Object.entries(results.control_derivs).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', marginBottom: '4px' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#818cf8' }}>{k}</span>
                              <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{v?.toFixed(5)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  <details className="raw-output">
                    <summary>Raw AVL output</summary>
                    <pre>{results.raw}</pre>
                  </details>
                </div>
              ) : (
                <div className="glass-panel placeholder-panel" style={{ height: '100%', display: 'flex', justifyContent: 'center' }}>
                  <div className="ph-icon">📊</div>
                  <p>Adjust parameters on the left, and click <strong>Run Analysis</strong> to see results here.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="welcome-card glass-panel">
            <div className="icon-plane">✈️</div>
            <h2>Aerodynamic Analysis Cockpit</h2>
            <p>Select an aircraft model from the top-right toolbar or upload your own <code>.avl</code> file to enter the interactive workspace.</p>
          </div>
        )}

        {/* ── Run Cases Compare Overlay ── */}
        {showCases && runCases.length > 0 && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '900px', maxHeight: '80vh', overflow: 'auto', position: 'relative' }}>
              <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowCases(false)}>✕</button>
              <h2 style={{ marginBottom: '20px' }}>📋 Run Cases Comparison</h2>
              <div className="sections-table-wrap">
                <table className="sections-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Case</th><th>α</th><th>β</th><th>CL</th><th>CD</th><th>L/D</th><th>Cm</th><th>Xnp</th><th>e</th>
                      <th style={{ width: '30px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runCases.map((c, i) => (
                      <tr key={i}>
                        <td style={{ color: '#818cf8', fontWeight: 600 }}>{c.label}</td>
                        <td>{Number(c.alpha).toFixed(2)}°</td>
                        <td>{Number(c.beta).toFixed(1)}°</td>
                        <td style={{ color: '#3b82f6' }}>{c.CL?.toFixed(4)}</td>
                        <td style={{ color: '#ef4444' }}>{c.CD?.toFixed(5)}</td>
                        <td style={{ color: '#10b981' }}>{c.CL && c.CD ? (c.CL / c.CD).toFixed(2) : '—'}</td>
                        <td>{c.Cm?.toFixed(4)}</td>
                        <td>{c.Xnp?.toFixed(4)}</td>
                        <td>{c.e?.toFixed(4)}</td>
                        <td><button onClick={() => setRunCases(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem' }}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Metric Card ── */
function MetricCard({ label, value, decimals = 4, accent = '#818cf8' }) {
  return (
    <div className="metric-card" style={{ borderLeft: `3px solid ${accent}22` }}>
      <span className="metric-label">{label}</span>
      <span className="metric-value" style={{ color: accent }}>{value != null ? value.toFixed(decimals) : '—'}</span>
    </div>
  );
}

/* ── Derivative Table ── */
function DerivTable({ title, items, color = '#818cf8' }) {
  return (
    <div className="deriv-table">
      <div className="deriv-table-title" style={{ color }}>{title}</div>
      <table>
        <tbody>
          {items.map(([name, val], i) => (
            <tr key={i}>
              <td className="deriv-name">{name}</td>
              <td className="deriv-val" style={{ color: val != null && val < 0 ? '#ef4444' : val != null && val > 0 ? '#10b981' : 'var(--text-muted)' }}>
                {val != null ? val.toFixed(4) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Planform SVG ── */
function PlanformSVG({ parsed }) {
  const svgData = useMemo(() => {
    if (!parsed?.surfaces?.length) return null;
    const polygons = [];
    let allX = [], allY = [];
    parsed.surfaces.forEach(surf => {
      if (!surf.sections?.length) return;
      const tx = surf.translate ? surf.translate[0] : 0;
      const ty = surf.translate ? surf.translate[1] : 0;
      const le = [], te = [];
      surf.sections.forEach(sec => {
        const x = sec.Xle + tx;
        const y = sec.Yle + ty;
        le.push({ x, y });
        te.push({ x: x + sec.Chord, y });
        allX.push(x, x + sec.Chord);
        allY.push(y);
      });
      const pts = [...le, ...te.reverse()];
      polygons.push(pts);
      const shouldMirrorY = (surf.yduplicate != null) || (parsed.iYsym === 1 && surf.sections.some(sec => Math.abs(sec.Yle) > 1e-5));
      if (shouldMirrorY) {
        const mirrorLE = le.map(p => ({ x: p.x, y: -p.y }));
        const mirrorTE = te.map(p => ({ x: p.x, y: -p.y }));
        polygons.push([...mirrorLE, ...mirrorTE.reverse()]);
        allY.push(...le.map(p => -p.y));
      }
    });
    if (!allX.length) return null;
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 24;
    const width = 400;
    const height = Math.max(200, width * (rangeY / rangeX));
    const scaleX = (width - padding * 2) / rangeX;
    const scaleY = (height - padding * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const cx = width / 2, cy = height / 2;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const toSVG = (p) => ({
      sx: cx + (p.y - midY) * scale,
      sy: cy + (p.x - midX) * scale,
    });
    const cg = toSVG({ x: parsed.Xref, y: parsed.Yref });
    return { polygons, toSVG, width, height, cg };
  }, [parsed]);

  if (!svgData) return <p className="placeholder-text">No geometry data</p>;
  return (
    <svg viewBox={`0 0 ${svgData.width} ${svgData.height}`} className="planform-svg" xmlns="http://www.w3.org/2000/svg">
      {svgData.polygons.map((pts, i) => {
        const d = pts.map((p, j) => {
          const { sx, sy } = svgData.toSVG(p);
          return `${j === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
        }).join(' ') + ' Z';
        return <path key={i} d={d} className="planform-surface" />;
      })}
      <circle cx={svgData.cg.sx} cy={svgData.cg.sy} r="6" className="cg-marker" />
      <text x={svgData.cg.sx + 10} y={svgData.cg.sy + 4} className="cg-label">CG</text>
    </svg>
  );
}

export default App;
