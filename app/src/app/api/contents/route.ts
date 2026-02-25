import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = 'https://api.usetapestry.dev/api/v1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const limit = searchParams.get('limit') || '50';
  const offset = searchParams.get('offset') || '0';

  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  if (!profileId) {
    return NextResponse.json({ error: 'Missing profileId' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/contents/profile/${profileId}?apiKey=${API_KEY}&limit=${limit}&offset=${offset}`, {
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
    const { profileId, content, customProperties } = body;

    if (!profileId || !content) {
      return NextResponse.json({ error: 'Missing profileId or content' }, { status: 400 });
    }

    const payload = {
      profileId,
      content,
      contentType: 'text',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      customProperties: customProperties || []
    };

    const response = await fetch(`${API_URL}/contents/findOrCreate?apiKey=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Failed to create content: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
