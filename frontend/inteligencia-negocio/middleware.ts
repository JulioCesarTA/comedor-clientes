// Next.js MIDDLEWARE — se ejecuta en el edge ANTES del render de cada ruta.
// Esto es imposible en React puro: solo existe en Next.js.
// Valida que exista un JWT Keycloak antes de dejar pasar a las rutas protegidas.
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/_next', '/favicon', '/api/health'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Dejar pasar rutas públicas y assets
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();

  // Verificar cookie o header con JWT
  const token = req.cookies.get('kc_token')?.value || req.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Decodificar payload base64 del JWT (sin validar firma en middleware por simplicidad)
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('expired', '1');
      return NextResponse.redirect(url);
    }
    // Pasar el username al downstream vía header (feature de middleware)
    const res = NextResponse.next();
    res.headers.set('x-user', payload.preferred_username || 'unknown');
    res.headers.set('x-roles', JSON.stringify(payload.realm_access?.roles || []));
    return res;
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/health).*)'],
};
