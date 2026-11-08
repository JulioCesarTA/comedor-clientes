'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const [user, setUser] = useState('admin.comedor');
  const [pass, setPass] = useState('admin123');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const body = new URLSearchParams({ grant_type: 'password', client_id: 'inteligencia-negocio', username: user, password: pass });
      const r = await fetch(`${process.env.NEXT_PUBLIC_KEYCLOAK_URL || `http://${window.location.hostname}:8085`}/realms/comedor-uagrm/protocol/openid-connect/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
      });
      if (!r.ok) throw new Error('Credenciales inválidas');
      const data = await r.json();
      document.cookie = `kc_token=${data.access_token}; path=/; max-age=${data.expires_in}`;
      const next = sp.get('next') || '/';
      router.push(next);
      router.refresh();
    } catch (e: any) { setErr(e.message); setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 fixed inset-0">
      <div className="w-full max-w-md p-8 bg-slate-800/60 backdrop-blur rounded-2xl shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-orange-500 rounded-2xl flex items-center justify-center text-4xl mb-4"></div>
          <h1 className="text-3xl font-bold text-white">Inteligencia de Negocio</h1>
          <p className="text-xs text-purple-400 font-mono mt-2">Panel de analítica · Keycloak OIDC</p>
        </div>
        <form onSubmit={doLogin} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2 font-semibold">Usuario</label>
            <input value={user} onChange={e => setUser(e.target.value)} required
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2 font-semibold">Contraseña</label>
            <input value={pass} onChange={e => setPass(e.target.value)} type="password" required
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-purple-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-semibold rounded-xl disabled:opacity-50">
            {loading ? 'Autenticando…' : ' Iniciar sesión'}
          </button>
        </form>
        {err && <p className="text-red-400 text-xs mt-4 text-center">{err}</p>}
        {sp.get('expired') && <p className="text-amber-400 text-xs mt-4 text-center"> Tu sesión expiró, iniciá sesión de nuevo</p>}
        <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
          <p className="text-xs text-slate-400 font-medium">Cuentas demo:</p>
          <code className="block text-xs text-cyan-400 mt-1">admin.comedor / admin123</code>
          <code className="block text-xs text-cyan-400">nutricionista.demo / nutri123</code>
        </div>
      </div>
    </div>
  );
}
