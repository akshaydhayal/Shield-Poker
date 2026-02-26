import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = process.env.NEXT_PUBLIC_TAPESTRY_API_URL;

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
      { key: 'total_games_played', value: '0' },
      { key: 'games_won', value: '0' },
      { key: 'games_lost', value: '0' }
    ];

    if (image) {
      customProperties.push({ key: 'profileImage', value: image });
    }

    const payload = {
      walletAddress: ownerWalletAddress,
      username,
      bio: bio || '',
      image: image || '',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      properties: customProperties
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
    
    // If the profile already existed, findOrCreate might NOT have updated the custom properties.
    // To be safe, if we have a profile ID, we can try to update it if the user is explicitly 
    // trying to "create" (initialize) it. However, let's first see if the URL fix alone handles it.
    
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
