import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = 'https://api.usetapestry.dev/api/v1';

export async function POST(request: Request) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const username = formData.get('username') as string;
    const ownerWalletAddress = formData.get('ownerWalletAddress') as string;
    const bio = formData.get('bio') as string | null;
    const image = formData.get('image') as string | null;

    if (!username || !ownerWalletAddress) {
      return NextResponse.json({ error: 'Missing username or wallet address' }, { status: 400 });
    }

    const customProperties = [
      { key: 'gamesPlayed', value: '0' },
      { key: 'gamesWon', value: '0' },
      { key: 'gamesLost', value: '0' }
    ];

    if (image) {
      customProperties.push({ key: 'profileImage', value: image });
    }

    const payload = {
      walletAddress: ownerWalletAddress,
      username,
      bio: bio || '',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      customProperties: customProperties
    };

    const response = await fetch(`${API_URL}/profiles/findOrCreate?apiKey=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Failed to create profile: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
