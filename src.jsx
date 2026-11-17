import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const dayLabel = new Intl.DateTimeFormat('en', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Yangon',
}).format(new Date());

const statuses = ['Present', 'Absent', 'Late', 'Excused'];
const today = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Yangon', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, ... (body === undefined ? {} : {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}),
  });
  if (res.status === 204) return;
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the form values and try again.');
  return data;
}

function App() {
  const [user,setUser] = useState(undefined);
  const [page,setPage] = useState('Overview');
  const [rooms,setRooms] = useState([]);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const refresh = () => api('/classes').then(setRooms);
  useEffect(() => { api('/me').then(setUser).catch(() => setUser(null)); },[]);
  useEffect(() => { if (user) refresh().catch(e => setError(e.message)); },[user]);
  async function action(work, success) {
    setError(''); setNotice(''); setBusy(true);
    try { await work(); if (success) setNotice(success); }
    catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const feedback = <>{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message" role="status">{notice}</p>}</>;
  if (user === undefined) return <main className="loading">Loading Rollcall…</main>;
  if (!user) return <main className="login">
    <section className="login-art"><Brand/><div><h1>Every student.<br/><em>Every day.</em></h1><div className="art" aria-hidden="true">{['✓','✓','·','✓','·','✓','✓','·','✓'].map((x,i)=><span key={i}>{x}</span>)}</div></div></section>
    <section className="login-form"><h2>Sign in</h2><p className="muted">Use your school attendance account.</p>{feedback}
    <form onSubmit={e => {e.preventDefault(); const values=Object.fromEntries(new FormData(e.currentTarget)); action(async()=>{setPage('Overview');setUser(await api('/login','POST',values));});}}>
    <label>Email<input name="email" type="email" autoComplete="username" required/></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
    <button disabled={busy}>Sign in <span aria-hidden="true">↗</span></button></form></section></main>;
  return <div className="workspace">
  <Sidebar user={user} page={page} busy={busy} navigate={item=>{setError('');setNotice('');setPage(item);}}
    signOut={()=>action(async()=>{await api('/logout','POST');setUser(null);})}/>
  <main><header className="workspace-heading"><h1>{page}</h1><time dateTime={today}>{dayLabel}</time></header>{feedback}
  {page==='Overview' && <Overview rooms={rooms} onAttendance={()=>setPage('Attendance')}/>}
  {page==='Attendance' && <Attendance key={user.id} rooms={rooms.filter(r=>r.active)} action={action} busy={busy} setError={setError}/>}
  {page==='Reports' && <Reports rooms={rooms} action={action} busy={busy}/>}
  {['Students','Classes','Teachers'].includes(page) && <Manage key={page} page={page} refresh={refresh} action={action} busy={busy} setError={setError}/>}
  </main></div>;
}

const navigation = [
  ['Workspace', [['Overview','◫'], ['Attendance','▦'], ['Reports','▥']]],
  ['Management', [['Students','◎'], ['Classes','▤'], ['Teachers','◇']]],
];

function Sidebar({user,page,busy,navigate,signOut}) {
  const initials = user.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  const groups = user.role === 'admin' ? navigation : navigation.slice(0,1);
  return <aside className="sidebar"><div className="sidebar-inner">
    <div className="sidebar-brand"><Brand/></div>
    <nav aria-label="Workspace">{groups.map(([label,items])=><section key={label} aria-label={label} className="nav-group">
      <h2>{label}</h2>
      {items.map(([item,icon])=><button key={item} type="button"
        aria-current={item===page ? 'page' : undefined} className={item===page ? 'current' : ''}
        onClick={()=>navigate(item)}>
        <span className="nav-icon" aria-hidden="true">{icon}</span>{item}
      </button>)}
    </section>)}</nav>
    <div className="sidebar-account">
      <div className="account-avatar" aria-hidden="true">{initials}</div>
      <div className="account-label"><strong>{user.name}</strong><small>{user.role==='admin' ? 'Administrator' : 'Teacher'}</small></div>
      <button type="button" className="sidebar-logout" disabled={busy} onClick={signOut}>Sign out <span aria-hidden="true">↗</span></button>
    </div>
  </div></aside>;
}

function Brand() { return <div className="brand"><span aria-hidden="true">✓</span>rollcall</div>; }

function Overview({rooms,onAttendance}) {
  const [room,setRoom] = useState('');
  const [end,setEnd] = useState(today);
  const [result,setResult] = useState(null);
  const query = new URLSearchParams({end, ...(room ? {room_id:room} : {})}).toString();
  useEffect(()=>{
    let current = true;
    if (end) api('/overview?'+query)
      .then(days=>{if(current)setResult({query,days});})
      .catch(error=>{if(current)setResult({query,error:error.message});});
    return ()=>{current=false;};
  },[query,end]);
  const current = result?.query===query ? result : null;
  const days = current?.days ?? [];
  const totals = Object.fromEntries(statuses.map(status=>[status,days.reduce((sum,day)=>sum+day[status],0)]));
  const total = row=>statuses.reduce((sum,status)=>sum+row[status],0);
  const recorded = total(totals);
  const max = Math.max(4,...days.map(total));
  const dateFormat = new Intl.DateTimeFormat('en',{weekday:'short',timeZone:'UTC'});
  return <div className="overview">
    <div className="overview-intro"><p>See how attendance is tracking across your classes.</p><button onClick={onAttendance}>Take attendance <span aria-hidden="true">↗</span></button></div>
    <section className="overview-filters" aria-label="Overview filters">
      <label>Class<select value={room} onChange={e=>setRoom(e.target.value)}><option value="">All classes</option>
      {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Week ending<input type="date" min="0001-01-07" max="9999-12-31" required value={end} onChange={e=>{if(e.target.validity.valid)setEnd(e.target.value);}}/></label>
    </section>
    {current?.error ? <p className="message error" role="alert">{current.error}</p> : !current ? <p role="status">Loading attendance…</p> : <>
      <section className="overview-metrics" aria-label="Attendance totals">
        {statuses.map((status,i)=><article key={status} className={'overview-metric '+status.toLowerCase()}>
          <span className="metric-icon" aria-hidden="true">{['✓','×','◷','◇'][i]}</span>
          <span>{status}</span><strong>{totals[status]}</strong>
        </article>)}
      </section>
      <div className="overview-grid">
        <section className="panel chart-card"><div className="chart-heading"><h2>Daily attendance</h2><p>Recorded marks over seven days</p></div>
          {recorded===0 ? <p className="chart-empty">No attendance recorded for this period.</p> : null}
          <div className="bar-chart" role="group" aria-label="Daily attendance by status">
            {days.map(day=><div className="chart-day" key={day.day} role="img"
              aria-label={day.day+': '+statuses.map(status=>status+' '+day[status]).join(', ')}>
              <div className="chart-track" aria-hidden="true">{statuses.map(status=>day[status]>0 &&
                <span key={status} className={'segment '+status.toLowerCase()} style={{height:(100*day[status]/max)+'%'}}/>)}</div>
              <span aria-hidden="true">{dateFormat.format(new Date(day.day+'T00:00:00Z'))}</span>
            </div>)}
          </div>
        </section>
        <section className="panel chart-card"><div className="chart-heading"><h2>Status breakdown</h2><p>{recorded} recorded {recorded===1?'mark':'marks'}</p></div>
          <ul className="breakdown">{statuses.map(status=><li key={status} className={status.toLowerCase()}>
            <div><span><i aria-hidden="true"/>{status}</span><strong>{recorded?Math.round(100*totals[status]/recorded):0}%</strong></div>
            <progress value={totals[status]} max={recorded||1} aria-label={status+' share'}/></li>)}</ul>
        </section>
      </div>
    </>}
  </div>;
}

function RoomSelect({rooms,value,onChange}) {
  return <label>Class<select value={value} onChange={e=>onChange(e.target.value)} required><option value="">Choose a class</option>
  {rooms.map(r=><option key={r.id} value={r.id}>{r.name}{r.active?'':' (archived)'}</option>)}</select></label>;
}

function Attendance({rooms,action,busy,setError}) {
  const [room,setRoom]=useState('');
  const [day,setDay]=useState(today);
  const [data,setData]=useState(null);
  const [marks,setMarks]=useState({});
  const path = '/classes/'+room+'/attendance/'+day;
  useEffect(()=>{
    let current=true; setData(null); setMarks({});
    if(room && day) api(path).then(result=>{if(current){setData(result);setMarks(Object.fromEntries(result.rows.filter(r=>r.status).map(r=>[r.id,r.status])));}}).catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[path]);
  const counts=Object.values(marks);
  return <><section className="banner"><div><h2>Take attendance</h2><p>Choose a class and date to open its roster.</p></div><div className="banner-art" aria-hidden="true"><span>✓</span><span>✓</span><span>·</span><span>✓</span></div></section>
  <section className="panel fields attendance-filters"><RoomSelect rooms={rooms} value={room} onChange={setRoom}/><label>Date<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label></section>
  {!room && <section className="panel roster-empty"><span aria-hidden="true">▦</span><h2>{rooms.length ? 'Open a class roster' : 'No active classes'}</h2>
    <p>{rooms.length ? 'Select a class above to record or review attendance.' : 'Active classes will appear here once they’re available to your account.'}</p></section>}
  {data && <><div className="stats">{[...statuses,'Not marked'].map(s=><div key={s} data-status={s.toLowerCase()}><span>{s}</span><strong>{s==='Not marked'?data.rows.length-counts.length:counts.filter(x=>x===s).length}</strong></div>)}</div>
  <section className="panel"><div className="section-head"><div><h2>{data.room.name}</h2><p className="muted roster-count">{data.rows.length} {data.rows.length === 1 ? 'student' : 'students'} · {day}</p></div>{!!data.rows.length && <button className="quiet" disabled={busy} onClick={()=>setMarks(old=>({...old,...Object.fromEntries(data.enrolled.map(id=>[id,'Present']))}))}>Mark all present</button>}</div>
  {!data.rows.length ? <p className="empty">This class has no enrolled students.</p> : <div className="table"><table><thead><tr><th>Student</th><th>Code</th><th>Status</th></tr></thead><tbody>
  {data.rows.map(row=><tr key={row.id}><td><div className="student-cell"><span aria-hidden="true" className="initial">{row.name.trim().charAt(0).toUpperCase()}</span><strong>{row.name}</strong></div></td><td><span className="student-code">{row.code}</span></td><td><div className="choices" role="group" aria-label={'Attendance for '+row.name}>{statuses.map(s=><button aria-pressed={marks[row.id]===s} className={s.toLowerCase()} key={s} disabled={busy} onClick={()=>setMarks(old=>({...old,[row.id]:s}))}>{s}</button>)}</div></td></tr>)}
  </tbody></table></div>}
  <div className="section-foot"><button disabled={busy||!counts.length} onClick={()=>action(()=>api(path,'PUT',{marks}),'Attendance saved.')}>Save attendance</button></div></section></>}</>;
}

function Reports({rooms,action,busy}) {
  const [room,setRoom]=useState('');
  const [start,setStart]=useState(today.slice(0,8)+'01');
  const [end,setEnd]=useState(today);
  const [rows,setRows]=useState(null);
  const [student,setStudent]=useState('');
  const shown=rows?.filter(r=> !student || r.code===student);
  function exportCsv() {
    const cell = value => {
      let str = String(value);
      if (/^[\s]*[=+@-]|^[\t\r\n]/.test(str)) str = "'" + str;
      return '"' + str.replaceAll('"','""') + '"';
    };
    const csv=['Date,Student,Code,Status', ...shown.map(r=>[r.day,r.name,r.code,r.status].map(cell).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    const link=document.createElement('a'); link.href=url; link.download='attendance.csv'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <><form className="panel fields" onSubmit={e=>{e.preventDefault();action(async()=>{setStudent('');setRows(await api('/reports?'+new URLSearchParams({room_id:room,start,end})));});}}>
  <RoomSelect rooms={rooms} value={room} onChange={v=>{setRoom(v);setRows(null);}}/><label>Start date<input type="date" required value={start} onChange={e=>{setStart(e.target.value);setRows(null);}}/></label>
  <label>End date<input type="date" required value={end} onChange={e=>{setEnd(e.target.value);setRows(null);}}/></label><button disabled={busy}>Run report</button></form>
  {rows && <><div className="stats">{statuses.map(s=><div key={s} data-status={s.toLowerCase()}><span>{s}</span><strong>{shown.filter(r=>r.status===s).length}</strong></div>)}</div>
  <section className="panel"><div className="section-head"><label>Student<select value={student} onChange={e=>setStudent(e.target.value)}><option value="">All students</option>{[...new Map(rows.map(r=>[r.code,r.name]))].map(([code,name])=><option key={code} value={code}>{name} · {code}</option>)}</select></label><button className="quiet" disabled={!shown.length} onClick={exportCsv}>Download CSV</button></div>
  <div className="table"><table><thead><tr><th>Date</th><th>Student</th><th>Code</th><th>Status</th></tr></thead><tbody>{shown.map(r=><tr key={r.day+r.code}><td>{r.day}</td><td>{r.name}</td><td>{r.code}</td><td><span className={'pill '+r.status.toLowerCase()}>{r.status}</span></td></tr>)}</tbody></table></div>
  {!shown.length && <p className="empty">No marks for this date range.</p>}</section></>}</>;
}

function Manage({page,refresh,action,busy,setError}) {
  const path='/'+page.toLowerCase();
  const [rows,setRows]=useState([]);
  const [teachers,setTeachers]=useState([]);
  const [students,setStudents]=useState([]);
  const [edit,setEdit]=useState(null);
  const [roster,setRoster]=useState(null);
  const refreshRows=()=>api(path).then(setRows);
  useEffect(()=>{refreshRows().catch(e=>setError(e.message)); if(page==='Classes'){
    Promise.all([api('/teachers'),api('/students')]).then(([t,s])=>{setTeachers(t);setStudents(s);}).catch(e=>setError(e.message));
  }},[page]);
  const classes=page==='Classes', teacher=page==='Teachers';
  return <><form className="panel fields" key={edit?.id??'new'} onSubmit={e=>{
    e.preventDefault(); const form=e.currentTarget; const values=Object.fromEntries(new FormData(form));
    if(classes)values.teacher_id=Number(values.teacher_id)||null;
    action(async()=>{await api(path+(edit?'/'+edit.id:''),edit?'PUT':'POST',values);form.reset();setEdit(null);await refreshRows();if(classes)await refresh();},'Record saved.');
  }}>
  <label>Name<input name="name" defaultValue={edit?.name} required maxLength={100}/></label>
  {classes?<label>Teacher<select name="teacher_id" defaultValue={edit?.teacher_id??''}><option value="">Unassigned</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  :teacher?<><label>Email<input name="email" type="email" required maxLength={150}/></label><label>Temporary password<input name="password" type="password" required minLength={12} maxLength={128}/></label></>
  :<label>Student code<input name="code" defaultValue={edit?.code} required maxLength={30}/></label>}
  <div className="choices"><button disabled={busy}>{edit?'Save changes':'Add '+(classes?'class':teacher?'teacher':'student')}</button>{edit&&<button type="button" className="quiet" onClick={()=>setEdit(null)}>Cancel</button>}</div></form>
  {roster && <section className="panel"><h2>Enroll students in {roster.room.name}</h2><div className="enroll">{students.filter(s=>s.active).map(s=><label key={s.id}><input type="checkbox" checked={roster.ids.includes(s.id)} onChange={e=>setRoster({...roster,ids:e.target.checked?[...roster.ids,s.id]:roster.ids.filter(id=>id!==s.id)})}/>{s.name} · {s.code}</label>)}</div>
  <div className="choices"><button disabled={busy} onClick={()=>action(async()=>{await api('/classes/'+roster.room.id+'/roster','PUT',roster.ids);setRoster(null);},'Roster saved.')}>Save roster</button><button className="quiet" onClick={()=>setRoster(null)}>Cancel</button></div></section>}
  <section className="panel"><div className="table"><table><thead><tr><th>Name</th><th>{classes?'Teacher':teacher?'Email':'Code'}</th>{!teacher&&<><th>Status</th><th>Actions</th></>}</tr></thead>
  <tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.name}</strong></td><td>{classes?(teachers.find(t=>t.id===row.teacher_id)?.name??'Unassigned'):teacher?row.email:row.code}</td>{!teacher&&<><td>{row.active?'Active':'Archived'}</td><td><div className="choices">
  <button className="quiet" disabled={busy} onClick={()=>setEdit(row)}>Edit</button>
  {classes&&row.active&&<button className="quiet" disabled={busy} onClick={()=>action(async()=>{const data=await api('/classes/'+row.id+'/attendance/'+today);setRoster({room:row,ids:data.enrolled});})}>Enroll</button>}
  {row.active&&<button className="quiet" disabled={busy} onClick={()=>{if(window.confirm('Archive '+row.name+'?'))action(async()=>{await api(path+'/'+row.id,'DELETE');setRoster(null);await refreshRows();if(classes)await refresh();},'Record archived.');}}>Archive</button>}</div></td></>}</tr>)}</tbody></table></div>
  {!rows.length&&<p className="empty">No records yet.</p>}</section></>;
}

createRoot(document.getElementById('root')).render(<App/>);
