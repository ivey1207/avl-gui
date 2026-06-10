import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';
import Airplane3D from './Airplane3D';

const API = 'http://127.0.0.1:8000';

function App() {
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
  const [showPolar, setShowPolar] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState('3d');
  const requestInProgress = useRef(false);


  useEffect(() => { fetchModels(); }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API}/api/models`);
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(data.models || []);
    } catch (e) { setError(e.message); }
  };

  const loadModel = async (filename) => {
    try {
      setLoading(true); setLoadingMsg('Loading model…'); setError(''); setResults(null);
      const res = await fetch(`${API}/api/load/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error('Failed to load model');
      const data = await res.json();
      setAvlContent(data.content); setParsed(data.parsed); setSelectedModel(filename);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setLoadingMsg(''); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setLoading(true); setLoadingMsg('Uploading…'); setError(''); setResults(null);
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
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
    setError(null);
    try {
      const response = await fetch(`${API}/api/run`, {
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
    } catch (err) { setError(err.message); }
    finally {
      setLoading(false);
      setLoadingMsg('');
      requestInProgress.current = false;
    }
  };

  const runPolarSweep = async (start = -5, end = 15, step = 1) => {
    if (!parsed || requestInProgress.current) return;
    requestInProgress.current = true;
    try {
      setLoading(true); setLoadingMsg('Calculating polar...');
      const res = await fetch(`${API}/api/run-polar`, {
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
      setShowPolar(true);
    } catch (e) { setError(e.message); }
    finally {
      setLoading(false);
      setLoadingMsg('');
      requestInProgress.current = false;
    }
  };

  const handleControlChange = (ctrlName, val) => {
    setControls(prev => ({ ...prev, [ctrlName]: parseFloat(val) }));
  };

  const xnpStable = results?.Xnp != null && parsed?.Xref != null && results.Xnp > parsed.Xref;
  const cmaStable = results?.Cma != null && results.Cma < 0;
  const staticMargin = (results?.Xnp != null && parsed?.Xref != null && parsed?.Cref)
    ? ((results.Xnp - parsed.Xref) / parsed.Cref * 100).toFixed(1) : null;

  // Dynamic Stability Calculations
  let shortPeriod = null;
  let phugoid = null;
  let isDynamicallyStable = null;

  if (results && parsed?.Sref && parsed?.Cref) {
    const mu = mass / (density * parsed.Sref * parsed.Cref);
    
    // Short Period
    if (results.Cma != null && results.CLa != null) {
      const wn_sp = Math.sqrt(Math.abs(results.Cma * results.CLa) / (2 * mu));
      const damping_sp = (results.Cmq != null && results.Cmad != null && wn_sp > 0) 
        ? -(results.Cmq + results.Cmad) / (2 * wn_sp) 
        : null;
      shortPeriod = { wn: wn_sp, zeta: damping_sp };
    }

    // Phugoid
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

  return (
    <div className="app-container">
      {loading && <div className="overlay"><div className="spinner"></div><span>{loadingMsg}</span></div>}
      
      <header className="glass-header">
        <div className="header-left">
          <h1>Athena Vortex Lattice</h1>
          <span className="subtitle">Aerodynamic Analysis Simulator</span>
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
                      <button className="btn-run" style={{ padding: '4px 8px', fontSize: '0.8rem', marginRight: '8px', background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={() => runSimulation('alpha')} disabled={loading}>
                        Trim (Cm=0)
                      </button>
                      <span className="alpha-badge">{alpha}°</span>
                    </div>
                  </div>
                  <input type="range" min="-10" max="20" step="0.5" value={alpha} onChange={(e) => setAlpha(e.target.value)} />
                </div>
                
                <div className="slider-container" style={{ marginTop: '12px' }}>
                  <div className="slider-header">
                    <span>Sideslip Angle (β)</span>
                    <span className="alpha-badge" style={{ background: 'var(--success)' }}>{beta}°</span>
                  </div>
                  <input type="range" min="-20" max="20" step="0.5" value={beta} onChange={(e) => setBeta(e.target.value)} />
                </div>

                <div className="slider-container" style={{ marginTop: '12px' }}>
                  <div className="slider-header">
                    <span>Center of Gravity (Xref)</span>
                    <span className="alpha-badge" style={{ background: '#ef4444' }}>{xrefOverride != null ? xrefOverride : (parsed.Xref || 0)}m</span>
                  </div>
                  <input type="range" min={(parsed.Xref || 0) - 1} max={(parsed.Xref || 0) + 1} step="0.01" value={xrefOverride != null ? xrefOverride : (parsed.Xref || 0)} onChange={(e) => setXrefOverride(parseFloat(e.target.value))} />
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
                        <input type="range" min="-30" max="30" step="0.5" value={controls[ctrl] || 0} onChange={(e) => handleControlChange(ctrl, e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-muted)' }}>Flight Parameters (Dynamic Stability)</h3>
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
                    {loading ? 'Calculating…' : '▶ Run Analysis'}
                  </button>
                  <button className="btn-run" onClick={() => runPolarSweep(-5, 15, 1)} disabled={loading} style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid var(--border)', color: 'var(--text)', marginTop: 0 }}>
                    Run Polar
                  </button>
                </div>
              </section>

              {/* Global Parameters */}
              <section className="glass-panel">
                <h2>Global Parameters</h2>
                <div className="plane-info">
                  <div className="info-row"><span className="info-label">Name</span><span className="info-value">{parsed.name}</span></div>
                  <div className="info-row"><span className="info-label">Mach</span><span className="info-value">{parsed.mach}</span></div>
                </div>
                <h3 className="subsection-title">Reference Dimensions</h3>
                <div className="params-grid">
                  <div className="param-item"><span className="param-label">Sref</span><span className="param-value">{parsed.Sref}</span><span className="param-unit">m²</span></div>
                  <div className="param-item"><span className="param-label">Cref</span><span className="param-value">{parsed.Cref}</span><span className="param-unit">m</span></div>
                  <div className="param-item"><span className="param-label">Bref</span><span className="param-value">{parsed.Bref}</span><span className="param-unit">m</span></div>
                </div>
                <h3 className="subsection-title">Reference Point (C.G.)</h3>
                <div className="params-grid">
                  <div className="param-item"><span className="param-label">Xref</span><span className="param-value">{parsed.Xref}</span></div>
                  <div className="param-item"><span className="param-label">Yref</span><span className="param-value">{parsed.Yref}</span></div>
                  <div className="param-item"><span className="param-label">Zref</span><span className="param-value">{parsed.Zref}</span></div>
                </div>
                <h3 className="subsection-title">Symmetry</h3>
                <div className="params-grid">
                  <div className="param-item"><span className="param-label">iYsym</span><span className="param-value">{parsed.iYsym}</span></div>
                  <div className="param-item"><span className="param-label">iZsym</span><span className="param-value">{parsed.iZsym}</span></div>
                  <div className="param-item"><span className="param-label">Zsym</span><span className="param-value">{parsed.Zsym}</span></div>
                </div>
              </section>

              {/* Surfaces */}
              <section className="glass-panel" style={{ flex: 1, minHeight: '300px' }}>
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
                          <div className="param-item"><span className="param-label">Cspace</span><span className="param-value">{surf.cspace}</span></div>
                          <div className="param-item"><span className="param-label">Nspan</span><span className="param-value">{surf.nspan}</span></div>
                          <div className="param-item"><span className="param-label">Sspace</span><span className="param-value">{surf.sspace}</span></div>
                        </div>
                        {surf.yduplicate != null && <div className="info-row"><span className="info-label">Y-Duplicate</span><span className="info-value">{surf.yduplicate}</span></div>}
                        {surf.angle != null && <div className="info-row"><span className="info-label">Incidence</span><span className="info-value">{surf.angle}°</span></div>}
                        <div className="sections-table-wrap">
                          <table className="sections-table">
                            <thead><tr><th>#</th><th>Xle</th><th>Yle</th><th>Zle</th><th>Chord</th><th>Ainc</th><th>Airfoil</th></tr></thead>
                            <tbody>
                              {surf.sections.map((sec, sei) => (
                                <tr key={sei}><td>{sei+1}</td><td>{sec.Xle}</td><td>{sec.Yle}</td><td>{sec.Zle}</td><td>{sec.Chord}</td><td>{sec.Ainc}</td><td>{sec.afile||'—'}</td></tr>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'rgba(10, 14, 26, 0.8)', borderBottom: '1px solid rgba(99, 102, 241, 0.2)', zIndex: 10 }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '16px', background: 'var(--accent)', borderRadius: '2px' }}></span>
                  Geometry Studio
                </h2>
                <div className="control-btn-group" style={{ position: 'static', pointerEvents: 'auto' }}>
                  <button className={viewTab === '3d' ? 'active' : ''} onClick={() => setViewTab('3d')}>3D Model</button>
                  <button className={viewTab === '2d' ? 'active' : ''} onClick={() => setViewTab('2d')}>2D SVG</button>
                </div>
              </div>
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', height: 'calc(100% - 53px)' }}>
                <div style={{ display: viewTab === '3d' ? 'block' : 'none', height: '100%' }}>
                  <Airplane3D parsed={displayParsed} results={results} />
                </div>
                <div style={{ display: viewTab === '2d' ? 'flex' : 'none', padding: '24px', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  {parsed && <PlanformSVG parsed={displayParsed} />}
                </div>
              </div>
            </div>

            {/* ── Column 3: Results (Right) ── */}
            <div className="right-panel">
              {results ? (
                <div className="results-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <section className="glass-panel">
                    <h2>Analysis Results</h2>
                    <p className="results-subtitle" style={{ margin: '-8px 0 16px' }}>
                      Model: <strong>{parsed.name}</strong> &nbsp;|&nbsp; α = {results.alpha ?? alpha}°
                    </p>

                    {/* Total Coefficients */}
                    <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      <MetricCard label="Lift (CL)" value={results.CL} decimals={4} />
                      <MetricCard label="Drag (CD)" value={results.CD} decimals={5} />
                      <MetricCard label="Pitch (Cm)" value={results.Cm} decimals={4} />
                      <MetricCard label="Side Force (CY)" value={results.CYtot} decimals={5} />
                      <MetricCard label="Roll (Cl)" value={results.Cltot} decimals={5} />
                      <MetricCard label="Yaw (Cn)" value={results.Cntot} decimals={5} />
                      <MetricCard label="Induced Drag" value={results.CDind} decimals={5} />
                      <MetricCard label="Oswald Eff." value={results.e_oswald} decimals={4} />
                    </div>
                  </section>

                  {/* Stability */}
                  <section className="glass-panel">
                    <h2>Stability</h2>
                    <div className="stability-grid">
                      <div className={`stability-card ${xnpStable ? 'stable' : 'unstable'}`}>
                        <div className="stab-title">Neutral Point (Xnp)</div>
                        <div className="stab-value">{results.Xnp != null ? results.Xnp.toFixed(3) : '—'}</div>
                        <div className="stab-msg">
                          {staticMargin != null && <span>Static Margin: {staticMargin}% MAC</span>}
                          <br />
                          {xnpStable ? '✅ Stable' : '❌ Unstable'}
                        </div>
                      </div>
                      <div className={`stability-card ${cmaStable ? 'stable' : 'unstable'}`}>
                        <div className="stab-title">Pitch Stiffness (Cmα)</div>
                        <div className="stab-value">{results.Cma != null ? results.Cma.toFixed(4) : '—'}</div>
                        <div className="stab-msg">{cmaStable ? '✅ Self-correcting' : '❌ Divergent'}</div>
                      </div>
                      <div className={`stability-card ${isDynamicallyStable ? 'stable' : 'unstable'}`} style={{ gridColumn: 'span 2' }}>
                        <div className="stab-title">Dynamic Stability</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', gap: '16px' }}>
                          <div style={{ flex: 1, background: 'var(--bg-lighter)', padding: '8px', borderRadius: '4px' }}>
                            <strong style={{ fontSize: '0.85rem' }}>Short Period</strong><br/>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              ωn: {shortPeriod?.wn != null ? shortPeriod.wn.toFixed(2) : '—'} rad/s<br/>
                              ζ: {shortPeriod?.zeta != null ? shortPeriod.zeta.toFixed(4) : '—'}
                            </span>
                          </div>
                          <div style={{ flex: 1, background: 'var(--bg-lighter)', padding: '8px', borderRadius: '4px' }}>
                            <strong style={{ fontSize: '0.85rem' }}>Phugoid</strong><br/>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Period: {phugoid?.period != null ? phugoid.period.toFixed(1) : '—'} s<br/>
                              ζ: {phugoid?.zeta != null ? phugoid.zeta.toFixed(4) : '—'}
                            </span>
                          </div>
                        </div>
                        <div className="stab-msg" style={{ marginTop: '8px' }}>
                          {isDynamicallyStable != null ? (isDynamicallyStable ? 'Dynamically Stable ✅' : 'Dynamically Unstable ❌') : '—'}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Stability Derivatives Tables */}
                  <section className="glass-panel">
                    <h2>Stability Derivatives</h2>
                    <div className="deriv-tables-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      <DerivTable title="α Derivatives" items={[
                        ['CLα', results.CLa], ['CYα', results.CYa], ['Clα', results.Cla],
                        ['Cmα', results.Cma], ['Cnα', results.Cna],
                      ]} />
                      <DerivTable title="β Derivatives" items={[
                        ['CLβ', results.CLb], ['CYβ', results.CYb], ['Clβ', results.Clb],
                        ['Cmβ', results.Cmb], ['Cnβ', results.Cnb],
                      ]} />
                      <DerivTable title="Roll Rate (p)" items={[
                        ['CLp', results.CLp], ['CYp', results.CYp], ['Clp', results.Clp], ['Cnp', results.Cnp],
                      ]} />
                      <DerivTable title="Pitch Rate (q)" items={[
                        ['CLq', results.CLq], ['Cmq', results.Cmq],
                      ]} />
                      <DerivTable title="Yaw Rate (r)" items={[
                        ['CYr', results.CYr], ['Clr', results.Clr], ['Cnr', results.Cnr],
                      ]} />
                      <DerivTable title="α̇ Derivatives" items={[
                        ['CLα̇', results.CLad], ['Cmα̇', results.Cmad],
                      ]} />
                    </div>
                  </section>

                  <details className="raw-output">
                    <summary>Show raw AVL output</summary>
                    <pre>{results.raw}</pre>
                  </details>
                </div>
              ) : (
                <div className="glass-panel placeholder-panel" style={{ height: '100%', display: 'flex', justifyContent: 'center' }}>
                  <div className="ph-icon">📊</div>
                  <p>Adjust parameters on the left, and click <strong>Run Analysis</strong> to see aerodynamic coefficients here.</p>
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

        {/* Polar Graph Overlay */}
        {showPolar && polarData && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '1000px', height: '80vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }} onClick={() => setShowPolar(false)}>✕</button>
              <h2 style={{ marginBottom: '24px' }}>Aerodynamic Polars</h2>
              <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ textAlign: 'center', marginBottom: '16px' }}>CL vs CD (Drag Polar)</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={polarData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="CD" stroke="rgba(255,255,255,0.5)" type="number" domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(3)} />
                      <YAxis dataKey="CL" stroke="rgba(255,255,255,0.5)" />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                      <Line type="monotone" dataKey="CL" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ textAlign: 'center', marginBottom: '16px' }}>Cm vs Alpha (Pitch Stability)</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={polarData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="Alpha" stroke="rgba(255,255,255,0.5)" />
                      <YAxis dataKey="Cm" stroke="rgba(255,255,255,0.5)" />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                      <Line type="monotone" dataKey="Cm" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey={() => 0} stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="5 5" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

/* ── Metric Card Component ── */
function MetricCard({ label, value, decimals = 4 }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value != null ? value.toFixed(decimals) : '—'}</span>
    </div>
  );
}

/* ── Derivative Table Component ── */
function DerivTable({ title, items }) {
  return (
    <div className="deriv-table">
      <div className="deriv-table-title">{title}</div>
      <table>
        <tbody>
          {items.map(([name, val], i) => (
            <tr key={i}>
              <td className="deriv-name">{name}</td>
              <td className="deriv-val">{val != null ? val.toFixed(4) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Planform SVG Visualization ── */
function PlanformSVG({ parsed }) {
  const svgData = useMemo(() => {
    if (!parsed?.surfaces?.length) return null;

    // Collect all points from all surfaces (including mirrored)
    const polygons = [];
    let allX = [], allY = [];

    parsed.surfaces.forEach(surf => {
      if (!surf.sections?.length) return;
      const tx = surf.translate ? surf.translate[0] : 0;
      const ty = surf.translate ? surf.translate[1] : 0;

      // Build leading & trailing edge points
      const le = [], te = [];
      surf.sections.forEach(sec => {
        const x = sec.Xle + tx;
        const y = sec.Yle + ty;
        le.push({ x, y });
        te.push({ x: x + sec.Chord, y });
        allX.push(x, x + sec.Chord);
        allY.push(y);
      });

      // Build polygon: LE forward, TE backward
      const pts = [...le, ...te.reverse()];
      polygons.push(pts);

      // Mirror if yduplicate or if globally symmetric and not exactly on centerline
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
    const padding = 20;
    const width = 360;
    const height = Math.max(200, width * (rangeY / rangeX));

    const scaleX = (width - padding * 2) / rangeX;
    const scaleY = (height - padding * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const cx = width / 2;
    const cy = height / 2;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const toSVG = (p) => ({
      sx: cx + (p.y - midY) * scale,  // Y -> horizontal (span)
      sy: cy + (p.x - midX) * scale,  // X -> vertical (chord)
    });

    // CG marker
    const cg = toSVG({ x: parsed.Xref, y: parsed.Yref });

    return { polygons, toSVG, width, height, cg };
  }, [parsed]);

  if (!svgData) return <p className="placeholder-text">No geometry data</p>;

  return (
    <svg
      viewBox={`0 0 ${svgData.width} ${svgData.height}`}
      className="planform-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      {svgData.polygons.map((pts, i) => {
        const d = pts.map((p, j) => {
          const { sx, sy } = svgData.toSVG(p);
          return `${j === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
        }).join(' ') + ' Z';
        return <path key={i} d={d} className="planform-surface" />;
      })}
      {/* CG marker */}
      <circle cx={svgData.cg.sx} cy={svgData.cg.sy} r="5" className="cg-marker" />
      <text x={svgData.cg.sx + 8} y={svgData.cg.sy + 4} className="cg-label">CG</text>
    </svg>
  );
}

export default App;
