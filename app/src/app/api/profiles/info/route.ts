import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = process.env.NEXT_PUBLIC_TAPESTRY_API_URL;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');
  const walletAddress = searchParams.get('walletAddress');

  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  if (!username && !walletAddress) {
    return NextResponse.json({ error: 'Missing username or walletAddress' }, { status: 400 });
  }

  try {
    let queryParam = username ? `username=${username}` : `walletAddress=${walletAddress}`;
    const response = await fetch(`${API_URL}/profiles/?${queryParam}&apiKey=${API_KEY}`, {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Tapestry API Error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
