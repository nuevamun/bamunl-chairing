import type { APIRoute } from 'astro';
declare const __BUILD__: string;
export const prerender = false;
export const GET: APIRoute = () => new Response(JSON.stringify({ build: __BUILD__ }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
