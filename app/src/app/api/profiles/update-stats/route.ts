import { NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_TAPESTRY_API_KEY;
const API_URL = process.env.NEXT_PUBLIC_TAPESTRY_API_URL;

export async function POST(request: Request) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'Tapestry API key missing' }, { status: 500 });
  }

  try {
    const { walletAddress, result } = await request.json();

    if (!walletAddress || !result) {
      return NextResponse.json({ error: 'Missing walletAddress or result' }, { status: 400 });
    }

    // 1. Fetch current profile to get existing stats
    const profileRes = await fetch(`${API_URL}/profiles/?walletAddress=${walletAddress}&apiKey=${API_KEY}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 }
    });

    if (!profileRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch profile' }, { status: profileRes.status });
    }

    const profileData = await profileRes.json();
    const profiles = profileData.profiles || [];
    
    if (profiles.length === 0) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const profile = profiles[0].profile;

    // 2. Helper to get and increment properties
    const getPropValue = (key: string) => {
        // Try direct property first (flat schema)
        if (profile[key] !== undefined && profile[key] !== null) {
            return parseInt(profile[key]) || 0;
        }
        // Fallback to customProperties
        if (!profile.customProperties) return 0;
        const prop = profile.customProperties.find((p: any) => p.key === key);
        return prop ? parseInt(prop.value) || 0 : 0;
    };

    const totalGames = getPropValue('total_games_played') + 1;
    let gamesWon = getPropValue('games_won');
    let gamesLost = getPropValue('games_lost');

    if (result === 'win') {
        gamesWon += 1;
    } else if (result === 'loss') {
        gamesLost += 1;
    }

    // 3. Prepare updated properties for Tapestry
    const updatedProperties = [
      { key: 'total_games_played', value: totalGames.toString() },
      { key: 'games_won', value: gamesWon.toString() },
      { key: 'games_lost', value: gamesLost.toString() }
    ];
    console.log("updatedProperties", updatedProperties);
    // If there were other properties we should ideally preserve them if Tapestry overwrites.
    // However, findOrCreate typically merges or the specific implementation might vary.
    // Based on user provided schema, we'll ensure these are set.
    if (profile.profileImage || profile.image) {
        updatedProperties.push({ key: 'profileImage', value: profile.profileImage || profile.image });
    }

    // 4. Persist back to Tapestry using PUT for updates
    const updatePayload = {
      username: profile.username,
      bio: profile.bio || '',
      image: profile.image || '',
      properties: updatedProperties,
      execution: 'FAST_UNCONFIRMED'
    };

    const updateRes = await fetch(`${API_URL}/profiles/${profile.id}?apiKey=${API_KEY}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      return NextResponse.json({ error: `Failed to update stats: ${errorText}` }, { status: updateRes.status });
    }

    const data = await updateRes.json();
    return NextResponse.json({ 
        success: true, 
        stats: { totalGames, gamesWon, gamesLost },
        data 
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
