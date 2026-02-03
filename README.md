# 🛡️ Shield Poker: Privacy-Preserving Poker Game

Live Project Link: [https://shield-poker.vercel.app/](https://shield-poker.vercel.app/)

Shield Poker is a decentralized, P2P Texas Hold'em game built on Solana. It leverages **MagicBlock's Private Ephemeral Rollups (PER)** to solve the "on-chain leakage" problem, keeping player hands absolutely private while maintaining 50ms execution speeds for real-time betting.

---
## 📺 Project Demo

### 🎥 Presentation Video
[https://drive.google.com/file/d/14YcDFWejDX3U-uRmo3FxuUtVDqCmWaf-/view?usp=drive_link](https://drive.google.com/file/d/14YcDFWejDX3U-uRmo3FxuUtVDqCmWaf-/view?usp=drive_link)


### 📸 Product Screenshots

<div align="center">
  <p><b>1. Poker HomePage</b></p>
  <img src="https://github.com/akshaydhayal/MagicBlock-Shield-Poker/blob/main/shield-poker-vercel-app.png" alt="Recipients Management" width="600">
  <br>
  <p><i>Lists all live Pending and completed Poker games</i></p>
  
  <p><b>2. Poker GamePage</b></p>
  <img src="https://github.com/akshaydhayal/MagicBlock-Shield-Poker/blob/main/localhost-3000-game-4.png" alt="Execute Payroll" width="600">
  <br>
  <p><i>Joined players can see game state and take actions such as fold, check, call or bet amount.</i></p>

  <p><b>2. Game Result/Showdown Phase</b></p>
  <img src="https://github.com/akshaydhayal/MagicBlock-Shield-Poker/blob/main/localhost-3000-game-3.png" alt="Execute Payroll" width="600">
  <br>
  <p><i>See which player won and how much</i></p>



</div>

---

## 🎯 The Problem
On standard blockchains, all state is public. For games like Poker, this is a non-starter:
1. **Card Privacy**: If your hand is on-chain, anyone can see it.
2. **Latency**: Waiting 400ms - 2s for every bet kills the game flow.
3. **Cost**: Transaction fees for every "Check" or "Small Bet" add up quickly.

## 🏗️ The Solution: MagicBlock PER
Shield Poker moves the sensitive game logic into a hardware-secured **Trusted Execution Environment (TEE)** using **Intel TDX**. 

### **Technical Deep Dive**

#### **1. Real-Time Privacy (Intel TDX TEE)**
The game logic runs within a TEE validator. This ensures that even the validator operator cannot peek at the memory where player hands are processed. We use the `#[ephemeral]` attribute to mark accounts that should exist primarily in the TEE for speed.

#### **2. Protocol-Level Access Control (ACL)**
Instead of just client-side encryption, Shield Poker uses MagicBlock's **Permission Program (ACL)**:
- **Public Accounts**: The `Game` account (pot, community cards) has a public ACL.
- **Private Accounts**: Each `PlayerState` (holding the hole cards) is protected by a restricted ACL. Only the specific player holding the corresponding TEE authorization token can read their own state.

#### **3. Fast State Settlement**
By delegating accounts to the TEE, we achieve **~50ms execution**. Once the "Showdown" occurs, the `commit_game` instruction triggers a state settlement:
- Final winner is determined in the TEE.
- The state is "committed" and "undelegated" back to Solana L1.
- Funds are distributed from the L1 Vault.

---

## 🚀 Architecture Diagram

```mermaid
sequenceDiagram
    participant P1 as Player 1 (Dealer)
    participant P2 as Player 2
    participant TEE as MagicBlock TEE (Intel TDX)
    participant L1 as Solana L1

    P1->>L1: Initialize Game & Vault
    P2->>L1: Join Game
    Note over P1, P2: Setup Delegation & ACLs
    P1->>TEE: Shuffle & Deal (Private)
    Note right of TEE: Cards stay in TEE memory
    P1->>TEE: Action: Bet (50ms)
    P2->>TEE: Action: Call (50ms)
    Note over TEE: Phase Advance (Flop/Turn/River)
    TEE->>L1: #[commit] Settle Final State
    L1->>P1/P2: Distribute Pot
```

---

## 🛠️ Getting Started

### Prerequisites
- Solana CLI & Anchor 0.32.1
- MagicBlock TEE Authorized Wallet

### Installation
1. **Clone the repo**
2. **Setup Program**:
   ```bash
   anchor build
   anchor deploy
   ```
3. **Launch Frontend**:
   ```bash
   cd app
   npm install
   npm run dev
   ```

---

## 🏆 Hackathon Submission
This project is submitted for the **Privacy Hack 2026** in the **MagicBlock Track**.

### **Key Innovations**
- **Zero-Leaking Hands**: Hands are never visible on L1 Explorers.
- **Instant Betting**: Real-time feedback loop without waiting for L1 finality.
- **Hybrid Security**: Trustless L1 settlement for funds, TEE privacy for game logic.

---

## 📄 License
MIT © 2026 Shield Poker Team
