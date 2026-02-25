import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = process.env.NEXT_PUBLIC_TAPESTRY_API_URL;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  if (!id) {
    return NextResponse.json({ error: 'Missing content ID' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/contents/${id}?apiKey=${API_KEY}`, {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 0 } // no-cache
    });

    if (response.status === 404) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

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
