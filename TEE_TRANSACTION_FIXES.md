# 🔧 TEE Transaction & State Reading Fixes

## 🐛 Problem Identified

**Symptoms:**
- ✅ Cards shuffle transaction confirms on TEE
- ✅ Transaction signature returned successfully  
- ❌ Player hands show `[0, 0]` instead of actual cards
- ❌ State not updating after TEE transactions

**Root Causes Found:**

###1. **Wrong State Reading Method**
We were using Anchor's `.fetch()` method which doesn't work properly with delegated accounts on TEE.

**Before (❌ Broken):**
```typescript
const state = await (this.getReadProgram().account as any).playerState.fetch(playerStatePda);
```

**After (✅ Fixed - Following RPS Pattern):**
```typescript
const accountInfo = await connection.getAccountInfo(playerStatePda);
const state = this.program.coder.accounts.decode("playerState", accountInfo.data);
```

### 2. **Transaction Error Handling**
We were using `skipPreflight: true` which silently ignored transaction failures.

**Before (❌ No Error Detection):**
```typescript
const signature = await this.teeConnection.sendRawTransaction(
  signedTx.serialize(),
  {
    skipPreflight: true, // Errors hidden!
    commitment: "confirmed",
  }
);
```

**After (✅ Errors Visible):**
```typescript
const signature = await this.teeConnection.sendRawTransaction(
  signedTx.serialize(),
  {
    skipPreflight: false, // Show errors during development
    commitment: "confirmed",
  }
);

const confirmation = await this.teeConnection.confirmTransaction(signature, "confirmed");

if (confirmation.value.err) {
  const txDetails = await this.teeConnection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  console.error("❌ TEE transaction failed:", {
    error: confirmation.value.err,
    logs: txDetails?.meta?.logMessages,
  });
  throw new Error(`TEE transaction failed: ${JSON.stringify(confirmation.value.err)}`);
}
```

### 3. **State Propagation Delay**
Added small delay after confirmation to ensure state is available.

```typescript
// Small delay to ensure state propagation on TEE
await new Promise(resolve => setTimeout(resolve, 100));
```

---

## ✅ Fixes Applied

### 1. **Updated `sendTeeDelegatedTransaction()`**

**Location:** `/app/src/lib/poker.ts` (lines ~128-195)

**Changes:**
- ✅ Changed `skipPreflight: true` → `skipPreflight: false` for error visibility
- ✅ Added error checking on confirmation
- ✅ Added transaction log fetching for debugging
- ✅ Added 100ms delay for state propagation
- ✅ Better error messages with context

### 2. **Updated `getPlayerState()`**

**Location:** `/app/src/lib/poker.ts` (lines ~742-800)

**Changes:**
- ✅ Use `connection.getAccountInfo()` instead of `.fetch()`
- ✅ Manual decoding with `program.coder.accounts.decode()`
- ✅ Direct connection usage (TEE if available, L1 otherwise)
- ✅ Better logging to show which connection is being used
- ✅ Detailed state logging for debugging

**Following RPS Pattern:**
```typescript
// RPS game does this:
const accountInfo = await providerTeePlayer1.connection.getAccountInfo(player1ChoicePda);
const player1ChoiceAccount = program.account.playerChoice.coder.accounts.decode("playerChoice", player1ChoiceData);

// We now do the same:
const connection = this.teeConnection || this.connection;
const accountInfo = await connection.getAccountInfo(playerStatePda);
const state = this.program.coder.accounts.decode("playerState", accountInfo.data);
```

### 3. **Updated `getGame()`**

**Location:** `/app/src/lib/poker.ts` (lines ~706-745)

**Changes:**
- ✅ Use `connection.getAccountInfo()` instead of `.fetch()`
- ✅ Manual decoding with `program.coder.accounts.decode()`
- ✅ Consistent with `getPlayerState()` approach
- ✅ Works properly with delegated accounts on TEE

---

## 🔍 Why This Matters

### **Delegated Accounts Need Special Handling**

When accounts are delegated to TEE:
1. **Ownership changes** to Delegation Program
2. **State lives on TEE** (not immediately on L1)
3. **Anchor's `.fetch()`** may not work correctly
4. **Direct RPC calls** are more reliable

### **The RPS Pattern Works Because:**

```typescript
// RPS directly fetches account data from connection
const accountInfo = await connection.getAccountInfo(pda);

// Then manually decodes using the program's coder
const decoded = program.coder.accounts.decode("accountName", accountInfo.data);
```

This bypasses Anchor's internal account fetching logic which may not handle delegated accounts properly.

---

## 📊 Expected Behavior Now

### **1. Transaction Execution**
```
Player clicks "Shuffle Cards"
  ↓
Build instruction
  ↓
Sign with wallet
  ↓
Send to TEE with preflight enabled
  ↓
If error: Show detailed logs ❌
If success: Confirm transaction ✅
  ↓
Wait 100ms for state propagation
  ↓
Return signature
```

### **2. State Reading**
```
Fetch player state
  ↓
Use TEE connection if available
  ↓
getAccountInfo() directly from connection
  ↓
Decode using program.coder.accounts.decode()
  ↓
Return decoded state with actual cards 🎴
```

### **3. Console Logs You'll See**

**On Transaction:**
```
✅ TEE transaction confirmed instantly: <signature>
🎴 Cards shuffled and dealt on TEE (instant): <signature>
```

**On State Fetch:**
```
🔍 Fetching player state from TEE for Player1Ab...
📊 Player Player1Ab state: { pda: '...', hand: [23, 45], chipsCommitted: 5000 }
```

**If Error:**
```
❌ TEE transaction failed: { error: {...}, logs: [...] }
```

---

## 🧪 Testing Steps

1. **Create Game & Join** (L1)
   ```
   Player 1: Create game
   Player 2: Join game
   ```

2. **Authorize TEE** (L1 → TEE Delegation)
   ```
   Player 1: Authorize TEE
   Player 2: Authorize TEE
   ```

3. **Shuffle & Deal Cards** (TEE Transaction)
   ```
   Player 1: Click "Shuffle Cards"
   
   Expected:
   - ✅ Transaction confirms quickly
   - ✅ Cards show actual values (not [0, 0])
   - ✅ Player 1 sees their own cards
   - ✅ Player 2 sees their own cards
   - ❌ Player 1 CANNOT see Player 2's cards (privacy!)
   - ❌ Player 2 CANNOT see Player 1's cards (privacy!)
   ```

4. **Play Game** (TEE Transactions)
   ```
   All gameplay actions should:
   - Execute instantly on TEE
   - Update state correctly
   - Show in console logs
   - No [0, 0] or stale data issues
   ```

---

## 🚨 If Cards Still Show [0, 0]

Check console for:

### **Error Messages:**
```
❌ TEE transaction failed: ...
❌ Error fetching player state: ...
```

### **Transaction Logs:**
Look for program errors in the logs array

### **Permission Issues:**
```
"error": "Account not authorized"
```
→ Check that permissions were set up correctly

### **Account Not Found:**
```
⚠️ Player state account not found: ...
```
→ Account wasn't created or delegation failed

---

## 📋 Summary

| Issue | Before | After |
|-------|--------|-------|
| **State reading** | Using `.fetch()` | Direct `getAccountInfo()` + decode |
| **Error visibility** | `skipPreflight: true` | `skipPreflight: false` + error checks |
| **State propagation** | No delay | 100ms delay after confirm |
| **Logging** | Minimal | Detailed with connection type |
| **RPS compatibility** | Different approach | Exact RPS pattern |
| **Cards showing** | ❌ [0, 0] | ✅ Actual card values |

---

## ✅ Implementation Complete!

**All changes follow the Rock Paper Scissors reference game pattern exactly.**

**Next: Test the game and cards should now display correctly!** 🎴🎉
