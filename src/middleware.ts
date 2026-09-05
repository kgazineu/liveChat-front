import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('chat_token')?.value

  const homeURL = new URL('/', request.url)
  const dashboardURL = new URL('/chat', request.url)

  if (request.nextUrl.pathname.startsWith('/chat')) {
    if (!token) {
      return NextResponse.redirect(homeURL)
    }
  }

  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register') {
    if (token) {
      return NextResponse.redirect(dashboardURL)
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