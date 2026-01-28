# 🚨 Critical TEE Transaction Fixes - "InvalidWritableAccount" Error

## 🐛 Problems Fixed

### 1. **"InvalidWritableAccount" Error When Dealing Cards**
**Error:** `TEE transaction failed: {error: 'InvalidWritableAccount', logs: Array(1)}`

**Root Cause:**
- Accounts not properly verified as delegated before attempting TEE writes
- Need to confirm all accounts (game, player1_state, player2_state) are delegated before TEE operations

**Solution:** Added `verifyAccountsDelegated()` method that checks on-chain ownership

---

### 2. **Delegation Failure After Refresh**
**Error:** `❌ Setup failed: {InstructionError: Array(2)}` when authorizing TEE after page refresh

**Root Cause:**
- Cache says "not delegated" but accounts are actually delegated on-chain
- System tries to re-delegate already delegated accounts
- Instruction fails because you can't delegate an already-delegated account

**Solution:**  
- Check on-chain state before attempting delegation
- Skip delegation for already-delegated accounts
- Return early if all accounts already delegated

---

## ✅ Fixes Applied

### Fix 1: Added Account Verification Method

**Location:** `/app/src/lib/poker.ts` (lines ~392-425)

```typescript
/**
 * Verify if accounts are properly delegated to TEE
 */
private async verifyAccountsDelegated(
  gameId: number,
  player1: PublicKey,
  player2?: PublicKey
): Promise<boolean> {
  const delegationProgramId = new PublicKey(
    "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
  );
  
  // Get all PDAs
  const [gamePda] = PublicKey.findProgramAddressSync(...);
  const [player1StatePda] = PublicKey.findProgramAddressSync(...);
  
  // Fetch account info from chain
  const gameInfo = await this.connection.getAccountInfo(gamePda);
  const player1Info = await this.connection.getAccountInfo(player1StatePda);
  
  // Check ownership
  const gameIsDelegated = gameInfo?.owner.equals(delegationProgramId) ?? false;
  const player1IsDelegated = player1Info?.owner.equals(delegationProgramId) ?? false;
  
  // Check player 2 if exists
  let player2IsDelegated = true;
  if (player2) {
    const [player2StatePda] = PublicKey.findProgramAddressSync(...);
    const player2Info = await this.connection.getAccountInfo(player2StatePda);
    player2IsDelegated = player2Info?.owner.equals(delegationProgramId) ?? false;
  }
  
  const allDelegated = gameIsDelegated && player1IsDelegated && player2IsDelegated;
  
  if (!allDelegated) {
    console.log("📊 Delegation status:", {
      game: gameIsDelegated ? "✅" : "❌",
      player1: player1IsDelegated ? "✅" : "❌",
      player2: player2 ? (player2IsDelegated ? "✅" : "❌") : "N/A",
    });
  }
  
  return allDelegated;
}
```

---

### Fix 2: Updated `ensureDelegation()` to Verify First

**Location:** `/app/src/lib/poker.ts` (lines ~430-465)

**Before:**
```typescript
async ensureDelegation(...) {
  // Check cache
  if (this.delegatedGames.has(gameId)) {
    return; // ❌ Trust cache without verifying
  }
  
  // Try to setup delegation
  await this.setupGamePermissions(...);
}
```

**After:**
```typescript
async ensureDelegation(...) {
  // Skip if TEE not available
  if (!this.teeProgram) return;

  // Verify on-chain state (not just cache!)
  const isDelegated = await this.verifyAccountsDelegated(gameId, player1, player2);
  
  if (isDelegated) {
    // Accounts ARE delegated, cache it and return
    if (!this.delegatedGames.has(gameId)) {
      console.log("✅ Accounts verified as delegated");
      this.delegatedGames.add(gameId);
    }
    return;
  }

  // Check if cached but not on-chain (stale cache)
  if (this.delegatedGames.has(gameId)) {
    this.delegatedGames.delete(gameId); // Clear stale cache
    throw new Error("❌ Accounts not properly delegated. Please authorize TEE again.");
  }

  // Accounts not delegated - user must authorize first
  throw new Error("Game accounts not delegated to TEE. Please click 'Authorize TEE' button first.");
}
```

**Key Changes:**
- ✅ Always verify on-chain state (not just cache)
- ✅ Clear stale cache if mismatch detected
- ✅ Throw error if not delegated (user must authorize)

---

### Fix 3: Skip Already-Delegated Accounts in `setupGamePermissions()`

**Location:** `/app/src/lib/poker.ts` (lines ~1057-1190)

**Added Check:**
```typescript
// Check if accounts are already delegated
const [gameAccountInfo, currentPlayerAccountInfo] = await Promise.all([
  this.connection.getAccountInfo(gamePda),
  this.connection.getAccountInfo(currentPlayerPda)
]);

const isGameAlreadyDelegated = gameAccountInfo?.owner.equals(gameDelegationProgramId) ?? false;
const isPlayerAlreadyDelegated = currentPlayerAccountInfo?.owner.equals(gameDelegationProgramId) ?? false;

// If both are already delegated, nothing to do
if (isGameAlreadyDelegated && isPlayerAlreadyDelegated) {
  console.log("✅ All accounts already delegated for this player");
  return; // Early exit!
}
```

**Delegation Logic:**
```typescript
// Delegate game only if not already delegated
if (isGameAlreadyDelegated) {
  console.log("ℹ️  Game account already delegated, skipping");
} else {
  // Create permission + delegate permission + delegate PDA
}

// Delegate player only if not already delegated
if (isPlayerAlreadyDelegated) {
  console.log(`ℹ️  Player account already delegated, skipping`);
  if (tx.instructions.length === 0) return; // Nothing to do
} else {
  // Create permission + delegate permission + delegate PDA
}

// Final check: if no instructions, return early
if (tx.instructions.length === 0) {
  console.log("✅ All accounts already delegated, nothing to do");
  return;
}
```

---

## 🎮 Expected Behavior Now

### **First Time Authorization:**

**Player 1:**
```
🔐 Setting up MagicBlock PER with FULL PRIVACY for game X
📝 Player 1 authorizing TEE...
📝 Creating Game permission...
🔒 Delegating Game permission...
🎮 Delegating Game PDA...
📝 Creating Player 1 permission (PRIVATE)...
🔒 Delegating Player 1 permission...
🃏 Delegating Player 1 PDA...
📤 Sending permission + delegation transaction...
✅ Player 1 setup complete: <txHash>
🎉 FULL PRIVACY ENABLED!
```

**Player 2:**
```
🔐 Setting up MagicBlock PER with FULL PRIVACY for game X
📝 Player 2 authorizing TEE...
ℹ️  Game account already delegated, skipping
📝 Creating Player 2 permission (PRIVATE)...
🔒 Delegating Player 2 permission...
🃏 Delegating Player 2 PDA...
📤 Sending permission + delegation transaction...
✅ Player 2 setup complete: <txHash>
🎉 FULL PRIVACY ENABLED!
```

---

### **After Refresh (Accounts Already Delegated):**

**Either Player Clicks "Authorize TEE":**
```
🔐 Setting up MagicBlock PER with FULL PRIVACY for game X
📝 Player X authorizing TEE...
✅ All accounts already delegated for this player
```

✅ **No wallet popup!**  
✅ **No transaction sent!**  
✅ **No InstructionError!**

---

### **Shuffle & Deal Cards:**

```
🔐 Checking delegation for game X
🔍 Fetching account info to verify delegation...
📊 Delegation status: {game: "✅", player1: "✅", player2: "✅"}
✅ Accounts verified as delegated

Generating random seed and shuffling cards for game X
✅ TEE transaction confirmed instantly: <signature>
🎴 Cards shuffled and dealt on TEE (instant): <signature>

🔍 Fetching player state from TEE for Player1...
📊 Player state: { hand: [23, 45], chipsCommitted: 5000000 }
✅ Cards displayed!
```

---

## 🔍 Debugging the "InvalidWritableAccount" Error

### **If Error Still Occurs, Check:**

1. **Are ALL accounts delegated?**
   ```typescript
   // Look for this in console:
   📊 Delegation status: {
     game: "❌ Not delegated",  // ← This is the problem!
     player1: "✅",
     player2: "✅"
   }
   ```

2. **Check account ownership on-chain:**
   ```bash
   solana account <gamePda> --url https://api.devnet.solana.com
   # Owner should be: DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
   ```

3. **Verify TEE connection:**
   ```typescript
   // Should see in console:
   TEE connection enabled - transactions will use ephemeral rollups
   ```

4. **Check transaction logs:**
   ```typescript
   // Error handler will show:
   ❌ TEE transaction failed: {
     error: 'InvalidWritableAccount',
     logs: [...]  // ← Check these logs!
   }
   ```

---

## 🚀 Testing Steps

### **1. Clean Start (No Delegation Yet):**
```
1. Create game (Player 1)
2. Join game (Player 2)
3. Try to shuffle cards ❌
   Expected: "Game accounts not delegated to TEE. Please click 'Authorize TEE' button first."
4. Authorize TEE (Player 1) ✅
5. Authorize TEE (Player 2) ✅
6. Shuffle cards ✅
   Expected: Cards dealt successfully!
```

### **2. After Page Refresh:**
```
1. Refresh browser
2. Navigate to game
3. Try to shuffle cards
   Expected: Works! (accounts still delegated on-chain)
4. Click "Authorize TEE" (optional)
   Expected: "✅ All accounts already delegated" (no transaction sent)
```

### **3. Delegation Status Check:**
```
1. Open browser console
2. Click "Shuffle Cards"
3. Look for delegation verification logs:
   📊 Delegation status: {game: "✅", player1: "✅", player2: "✅"}
   
If any show "❌":
   - That account is NOT delegated
   - User must authorize TEE again
```

---

## 📋 Summary

| Issue | Before | After |
|-------|--------|-------|
| **InvalidWritableAccount** | Assumed delegated | ✅ Verifies on-chain |
| **After refresh** | Cache mismatch | ✅ Always checks on-chain |
| **Re-delegation** | Attempts again (fails) | ✅ Skips if delegated |
| **Empty tx** | Sends anyway | ✅ Returns early |
| **Error messages** | Generic | ✅ Specific & helpful |

---

## ✅ What Should Work Now

1. ✅ **First time authorization** - Both players can authorize TEE successfully
2. ✅ **After refresh** - Delegation state persists (no re-authorization needed)
3. ✅ **Shuffle cards** - Only works if all accounts are delegated
4. ✅ **Clear error messages** - User knows exactly what to do
5. ✅ **No duplicate delegations** - System checks on-chain before attempting

---

## 🎯 Next Steps

1. **Test the flow:**
   - Fresh start → Authorize → Shuffle → Success!
   - Refresh → Shuffle → Still works!
   - Try to shuffle before authorizing → Clear error message!

2. **If "InvalidWritableAccount" persists:**
   - Check console for delegation status
   - Verify all accounts show "✅ Delegated"
   - Check that TEE connection is enabled
   - Inspect transaction logs for more details

3. **Monitor console logs:**
   - All delegation operations are logged
   - On-chain verification results are displayed
   - Helps debug any remaining issues

---

**All fixes are now in place! The system verifies delegation status on-chain before every TEE operation.** 🎉🔒
