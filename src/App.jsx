import React, { useState, useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import Editor from 'react-simple-code-editor';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BookOpen, Code2, Rocket, ChevronRight, 
  CheckCircle2, XCircle, Terminal, Play, 
  RotateCcw, Loader2, FlaskConical,
  Trophy, User, LogOut, Key, Coins, Hash
} from 'lucide-react';

const API = (import.meta.env.VITE_API_BASE_URL || '') + '/prod';
const SafeEditor = typeof Editor === 'function' ? Editor : (Editor && Editor.default ? Editor.default : Editor);
const hl = c => Prism.languages.python ? Prism.highlight(c, Prism.languages.python, 'python') : c;

function App() {
  const [modules, setModules] = useState([]);
  const [modIdx, setModIdx] = useState(() => parseInt(localStorage.getItem('cj_mod') || '0'));
  const [lesIdx, setLesIdx] = useState(() => parseInt(localStorage.getItem('cj_les') || '0'));
  const [view, setView] = useState(() => localStorage.getItem('cj_view') || 'theory');

  const [code, setCode] = useState('');
  const [playCode, setPlayCode] = useState(() => localStorage.getItem('cj_play') || '# Try your Python code here!\nprint("Hello, World!")');
  const [playOutput, setPlayOutput] = useState('// Click Run to execute your code');
  const [playRunning, setPlayRunning] = useState(false);

  const [status, setStatus] = useState(null);
  const [output, setOutput] = useState('// Click "Run Code" to submit.');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runCount, setRunCount] = useState(0);

  // Phase 2: Auth & Leaderboard
  const [user, setUser] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => { 
    fetchContent(); 
    fetchLeaderboard();
    const savedUser = localStorage.getItem('coding_judge_user');
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  useEffect(() => {
    localStorage.setItem('cj_mod', modIdx);
    localStorage.setItem('cj_les', lesIdx);
    localStorage.setItem('cj_view', view);
  }, [modIdx, lesIdx, view]);

  useEffect(() => {
    localStorage.setItem('cj_play', playCode);
  }, [playCode]);

  // Load saved code when user or lesson changes
  useEffect(() => {
    if (modules.length > 0) {
      const chId = modules[modIdx]?.lessons?.[lesIdx]?.challenges?.[0]?.id;
      if (chId && user) {
        const saved = localStorage.getItem(`cj_code_${user.username}_${chId}`);
        if (saved) {
          setCode(saved);
          return;
        }
      }
      setCode(modules[modIdx]?.lessons?.[lesIdx]?.challenges?.[0]?.starter_code || '');
    }
  }, [modIdx, lesIdx, user, modules]);

  const fetchContent = async () => {
    try {
      const r = await fetch(`${API}/content`);
      const d = await r.json();
      if (d?.length > 0) {
        setModules(d);
        if (!localStorage.getItem('cj_play')) {
          setPlayCode(d[modIdx]?.lessons?.[lesIdx]?.example_code || '# Write Python here\nprint("Hello!")');
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchLeaderboard = async () => {
    try {
      const r = await fetch(`${API}/leaderboard`);
      const d = await r.json();
      setLeaderboard(d || []);
      
      setUser(prev => {
        if (!prev) return prev;
        const myData = (d || []).find(u => u.username === prev.username);
        if (myData && (myData.points !== prev.points || myData.tokens !== prev.tokens)) {
          const updated = { ...prev, points: myData.points, tokens: myData.tokens };
          localStorage.setItem('coding_judge_user', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
    } catch (e) { console.error(e); }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const r = await fetch(`${API}/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: authMode, ...authForm })
      });
      const d = await r.json();
      if (!r.ok) { setAuthError(d.error); setAuthLoading(false); return; }
      
      const u = { username: d.username, tokens: d.tokens, points: d.points };
      setUser(u);
      localStorage.setItem('coding_judge_user', JSON.stringify(u));
      setShowAuth(false);
    } catch (e) { setAuthError('Connection error'); }
    finally { setAuthLoading(false); }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('coding_judge_user');
  };

  const runCode = async (codeStr, chId, setOut, setRun, onStatus) => {
    if (!user) { setShowAuth(true); return; }
    if (user.tokens <= 0) {
      setOut('❌ Daily token limit reached! Please wait until tomorrow.');
      return;
    }

    setRun(true);
    setOut('⏳ Submitting to AWS worker...');
    
    // Optimistic local token decrement
    setUser(prev => {
      const updated = { ...prev, tokens: prev.tokens - 1 };
      localStorage.setItem('coding_judge_user', JSON.stringify(updated));
      return updated;
    });

    try {
      const r = await fetch(`${API}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.username, challenge_id: chId, code: codeStr })
      });
      const d = await r.json();
      if (!d.submission_id) { setOut(`❌ ${d.error || 'Error'}`); setRun(false); return; }
      setOut('📡 Worker executing...');
      
      // Poll
      const iv = setInterval(async () => {
        try {
          const sr = await fetch(`${API}/status/${d.submission_id}`);
          const sd = await sr.json();
          if (onStatus) onStatus(sd.status);
          if (sd.status === 'RUNNING') setOut('⚙️ Running...');
          if (sd.stdout || sd.error_log) setOut(sd.error_log || sd.stdout);
          
          if (sd.status !== 'PENDING' && sd.status !== 'RUNNING') { 
            clearInterval(iv); 
            setRun(false); 
            if (sd.status === 'PASSED' && chId !== 'playground_sandbox') {
              setTimeout(() => fetchLeaderboard(), 1000); // give DB 1s to update
            }
          }
        } catch {}
      }, 1500);
      setTimeout(() => { clearInterval(iv); setRun(false); }, 30000);
    } catch (e) { setOut(`❌ ${e.message}`); setRun(false); }
  };

  const handleChallenge = () => {
    const ch = modules[modIdx]?.lessons?.[lesIdx]?.challenges?.[0];
    if (!ch) return;
    setRunCount(c => c + 1);
    setStatus('PENDING');
    runCode(code, ch.id, setOutput, setRunning, s => setStatus(s));
  };

  const handlePlayground = () => {
    runCode(playCode, 'playground_sandbox', setPlayOutput, setPlayRunning, null);
  };

  const handleReset = () => {
    const ch = modules[modIdx]?.lessons?.[lesIdx]?.challenges?.[0];
    if (ch) setCode(ch.starter_code || '');
    setStatus(null); setOutput('// Code reset.');
  };

  const handleCodeChange = (c) => {
    setCode(c);
    if (user) {
      const chId = modules[modIdx]?.lessons?.[lesIdx]?.challenges?.[0]?.id;
      if (chId) localStorage.setItem(`cj_code_${user.username}_${chId}`, c);
    }
  };

  const selectLesson = (mi, li) => {
    setModIdx(mi); setLesIdx(li); setView('theory');
    const les = modules[mi]?.lessons?.[li];
    setPlayCode(les?.example_code || '# Write Python here\nprint("Hello!")');
    setPlayOutput('// Click Run to execute');
    setStatus(null); setRunning(false); setOutput('// Click "Run Code" to submit.');
  };

  if (loading) return <div className="loading-screen"><Loader2 className="spin" size={22}/> Loading...</div>;

  const mod = modules[modIdx];
  const les = mod?.lessons?.[lesIdx];
  const ch = les?.challenges?.[0];

  return (
    <div className="pro-container">
      {/* AUTH MODAL */}
      <AnimatePresence>
        {showAuth && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="modal-overlay">
            <motion.div initial={{y:20}} animate={{y:0}} exit={{y:-20}} className="auth-modal">
              <button className="close-btn" onClick={()=>setShowAuth(false)}>×</button>
              <h2><User size={20}/> {authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
              <p>Sign in to run code, earn points, and climb the leaderboard.</p>
              
              <div className="auth-tabs">
                <button className={authMode==='login'?'active':''} onClick={()=>setAuthMode('login')}>Login</button>
                <button className={authMode==='register'?'active':''} onClick={()=>setAuthMode('register')}>Register</button>
              </div>

              <form onSubmit={handleAuth}>
                <div className="input-group">
                  <User size={14}/>
                  <input required placeholder="Username" value={authForm.username} onChange={e=>setAuthForm({...authForm, username: e.target.value})} />
                </div>
                <div className="input-group">
                  <Key size={14}/>
                  <input required type="password" placeholder="Password" value={authForm.password} onChange={e=>setAuthForm({...authForm, password: e.target.value})} />
                </div>
                {authError && <div className="auth-error">{authError}</div>}
                <button type="submit" className="auth-submit" disabled={authLoading}>
                  {authLoading ? <Loader2 className="spin" size={14}/> : 'Continue'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <aside className="pro-sidebar">
        <div className="logo"><Rocket className="icon-accent" size={18}/><span>CODE MASTER <span>PRO</span></span></div>
        
        {user ? (
          <div className="user-profile">
            <div className="user-info">
              <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
              <div>
                <div className="user-name">{user.username}</div>
                <div className="user-stats">
                  <span><Trophy size={10} color="#fbbf24"/> {user.points}</span>
                  <span><Coins size={10} color="#38bdf8"/> {user.tokens} left</span>
                </div>
              </div>
            </div>
            <button className="btn-logout" onClick={logout}><LogOut size={12}/></button>
          </div>
        ) : (
          <div className="login-prompt">
            <p>Login to save progress</p>
            <button onClick={()=>setShowAuth(true)}>Sign In</button>
          </div>
        )}

        <div className="module-nav">
          <div className="nav-group">
            <div className="nav-label">Global</div>
            <button className={`nav-item ${view==='leaderboard'?'active':''}`} onClick={()=>{setView('leaderboard'); fetchLeaderboard();}}>
              <Trophy size={12}/> Leaderboard
            </button>
          </div>
          
          {modules.map((m, mi) => (
            <div key={m.id} className="nav-group">
              <div className="nav-label">{m.title}</div>
              {m.lessons.map((l, li) => (
                <button key={l.id} className={`nav-item ${mi===modIdx&&li===lesIdx&&view!=='leaderboard'?'active':''}`}
                  onClick={() => selectLesson(mi, li)}>
                  <BookOpen size={12}/> {l.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="pro-main">
        <header className="pro-header">
          <div className="breadcrumb">
            {view === 'leaderboard' ? 'Global Leaderboard' : <>{mod?.title} <ChevronRight size={12}/> {les?.title}</>}
          </div>
          <div className="view-tabs">
            {view !== 'leaderboard' && (
              <>
                <button className={view==='theory'?'active':''} onClick={()=>setView('theory')}><BookOpen size={12}/> Theory</button>
                <button className={view==='playground'?'active':''} onClick={()=>setView('playground')}><FlaskConical size={12}/> Playground</button>
                <button className={view==='challenge'?'active':''} onClick={()=>setView('challenge')}><Code2 size={12}/> Challenge</button>
              </>
            )}
          </div>
        </header>

        <section className="content-area">
          <AnimatePresence mode="wait">
            {view === 'leaderboard' && (
              <motion.div key="l" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="leaderboard-view">
                <div className="leaderboard-hero">
                  <h1><Trophy size={28} color="#fbbf24"/> Global Leaderboard</h1>
                  <p>Top developers ranked by total points. Complete challenges to climb the ranks!</p>
                </div>
                
                <div className="leaderboard-table-container">
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Developer</th>
                        <th className="text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((u, i) => (
                        <tr key={u.username} className={u.username === user?.username ? 'current-user' : ''}>
                          <td>
                            <div className={`rank-badge rank-${i+1}`}>
                              {i < 3 ? <Trophy size={14}/> : <Hash size={14}/>} {i+1}
                            </div>
                          </td>
                          <td className="player-name">{u.username} {u.username === user?.username && '(You)'}</td>
                          <td className="text-right points-col">{u.points} pts</td>
                        </tr>
                      ))}
                      {leaderboard.length === 0 && (
                        <tr><td colSpan="3" className="empty-state">No players found. Be the first to earn points!</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {view === 'theory' && (
              <motion.div key="t" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="theory-view">
                <h1>{les?.title}</h1>
                <div className="markdown-body">
                  {les?.content?.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
                    if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
                    if (line.startsWith('```')) return null;
                    if (line.startsWith('| ')) return <code key={i} className="table-line">{line}</code>;
                    if (line.startsWith('- ')) return <p key={i}>• {line.slice(2)}</p>;
                    if (line.trim()==='') return <br key={i}/>;
                    return <p key={i} dangerouslySetInnerHTML={{__html: line.replace(/`([^`]+)`/g,'<code style="background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:3px;font-family:Fira Code,monospace;font-size:0.85em">$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}} />;
                  })}
                </div>
                {les?.example_code && (
                  <div className="example-box">
                    <h3>💡 Example Code:</h3>
                    <pre><code dangerouslySetInnerHTML={{__html: hl(les.example_code)}} /></pre>
                  </div>
                )}
                <button className="btn-next" onClick={()=>{
                  setPlayCode(les?.example_code || '# Write Python here\nprint("Hello!")');
                  setPlayOutput('// Click Run to execute');
                  setView('playground');
                }}>Try in Playground <ChevronRight size={14}/></button>
              </motion.div>
            )}

            {view === 'playground' && (
              <motion.div key="p" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="playground-view">
                <h2><FlaskConical size={18}/> Code Playground</h2>
                <p className="playground-subtitle">Experiment freely! Edit the example code or write your own. Your code runs in a secure AWS sandbox.</p>
                <div className="editor-container">
                  <SafeEditor value={playCode} onValueChange={c=>setPlayCode(c)} highlight={hl} padding={16} className="playground-editor-area" />
                  <div className="editor-footer">
                    <div className="editor-actions">
                      <button className={`btn-run ${playRunning?'loading':''}`} onClick={handlePlayground} disabled={playRunning}>
                        {playRunning ? <Loader2 className="spin" size={13}/> : <Play size={13}/>}
                        {playRunning ? 'Running...' : 'Run'}
                      </button>
                      <button className="btn-reset" onClick={()=>{setPlayCode(les?.example_code||'print("Hello!")');setPlayOutput('');}}>
                        <RotateCcw size={12}/> Reset
                      </button>
                    </div>
                  </div>
                </div>
                <div className="pro-terminal">
                  <div className="terminal-header"><Terminal size={11}/> OUTPUT {playRunning&&<Loader2 className="spin" size={11}/>}</div>
                  <pre>{playOutput}</pre>
                </div>
              </motion.div>
            )}

            {view === 'challenge' && (
              <motion.div key="c" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="editor-view">
                <div className="challenge-desc">
                  <div className="challenge-header">
                    {ch&&<div className={`badge ${ch.difficulty?.toLowerCase()}`}>{ch.difficulty}</div>}
                    {ch&&<div className="points-badge">🏆 {ch.points} pts</div>}
                  </div>
                  <h2>{ch?.title}</h2>
                  <div className="challenge-text">
                    {ch?.description?.split('\n').map((line,i) => {
                      if (line.startsWith('```')) return null;
                      if (line.trim()==='') return <br key={i}/>;
                      return <p key={i} dangerouslySetInnerHTML={{__html: line.replace(/`([^`]+)`/g,'<code style="background:rgba(99,102,241,0.15);padding:1px 5px;border-radius:3px;font-family:Fira Code,monospace;font-size:0.85em">$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}} />;
                    })}
                  </div>
                </div>
                <div className="editor-container">
                  <SafeEditor value={code} onValueChange={handleCodeChange} highlight={hl} padding={16} className="pro-editor" />
                  <div className="editor-footer">
                    <div className="editor-actions">
                      <button className={`btn-run ${running?'loading':''}`} onClick={handleChallenge} disabled={running}>
                        {running?<Loader2 className="spin" size={13}/>:<Play size={13}/>}
                        {running?'Running...':'Run Code'}
                      </button>
                      <button className="btn-reset" onClick={handleReset} disabled={running}><RotateCcw size={12}/> Reset</button>
                      {runCount>0&&<span className="run-counter">Runs: {runCount}</span>}
                    </div>
                    {status&&status!=='PENDING'&&status!=='RUNNING'&&(
                      <div className={`status-pill ${status.toLowerCase()}`}>
                        {status==='PASSED'?<CheckCircle2 size={12}/>:<XCircle size={12}/>} {status}
                      </div>
                    )}
                  </div>
                </div>
                <div className="pro-terminal">
                  <div className="terminal-header"><Terminal size={11}/> OUTPUT {running&&<Loader2 className="spin" size={11}/>}</div>
                  <pre>{output}</pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}

export default App;
