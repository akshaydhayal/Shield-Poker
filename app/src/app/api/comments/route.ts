import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = 'https://api.usetapestry.dev/api/v1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contentId = searchParams.get('contentId');
  const limit = searchParams.get('limit') || '50';
  const offset = searchParams.get('offset') || '0';

  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  if (!contentId) {
    return NextResponse.json({ error: 'Missing contentId' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/comments/?contentId=${contentId}&apiKey=${API_KEY}&limit=${limit}&offset=${offset}`, {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 0 } // no-cache
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

export async function POST(request: Request) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { profileId, contentId, text } = body;

    if (!profileId || !contentId || !text) {
      return NextResponse.json({ error: 'Missing profileId, contentId, or text' }, { status: 400 });
    }

    const payload = {
      profileId,
      contentId,
      text,
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED'
    };

    const response = await fetch(`${API_URL}/comments/?apiKey=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Failed to create comment: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
