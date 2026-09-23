import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get('chat_token')?.value
  const refreshToken = request.cookies.get('chat_refresh_token')?.value
  const hasSession = Boolean(token || refreshToken)

  const homeURL = new URL('/', request.url)
  const dashboardURL = new URL('/chat', request.url)

  if (request.nextUrl.pathname.startsWith('/chat')) {
    if (!hasSession) {
      return noStoreRedirect(homeURL)
    }
  }

  if (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/register') {
    if (hasSession) {
      return noStoreRedirect(dashboardURL)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/chat/:path*', 
    '/', 
    '/register'
  ]
}
