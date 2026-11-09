// Antes de mostrar una pantalla protegida comprueba que haya un token de Keycloak vigente; si no, manda al login.
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/_next', '/favicon', '/api/health', '/sw.js'];

function alLogin(req: NextRequest, params: Record<string, string>) {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get('kc_token')?.value || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return alLogin(req, { next: pathname });

  // Solo se mira el vencimiento: la firma la valida el gateway en cada llamada a la API.
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return alLogin(req, { expired: '1' });
    // usuario y roles para el layout (barra lateral): viajan como cabeceras de la PETICIÓN, que es lo que lee headers()
    const h = new Headers(req.headers);
    h.set('x-user', payload.preferred_username || 'unknown');
    h.set('x-roles', JSON.stringify(payload.realm_access?.roles || []));
    return NextResponse.next({ request: { headers: h } });
  } catch {
    return alLogin(req, {});
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|login|api/health).*)'],
};
