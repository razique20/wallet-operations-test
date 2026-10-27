import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Tx = {id:number; amount:string; kind:string; status:string; reference:string; failure_reason:string|null};
const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
function App() {
  const [items,setItems] = useState<Tx[]>([]);
  const [error,setError] = useState('');
  const [selected,setSelected] = useState<Tx|null>(null);
  useEffect(() => {
    fetch(`${API}/transactions`,{headers:{'X-User-Id':'1'}})
      .then(r=>r.json()).then(setItems).catch(()=>setError('Unable to load transactions'));
  },[]);
  return <main style={{maxWidth:850,margin:'40px auto',fontFamily:'sans-serif'}}>
    <h1>Wallet Operations</h1>
    <p>Transaction history (demo account)</p>
    {error && <p role="alert">{error}</p>}
    <table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Reference</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>{items.map(t=><tr key={t.id} onClick={()=>setSelected(t)} style={{cursor:'pointer'}}><td>{t.reference}</td><td>{t.kind}</td><td>{t.amount}</td><td>{t.status}</td></tr>)}</tbody></table>
    {selected && <section><h2>Transaction #{selected.id}</h2><p>Status: {selected.status}</p><p>Failure reason: {selected.failure_reason||'—'}</p></section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
