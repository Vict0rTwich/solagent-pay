/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solagent_pay.json`.
 */
export type SolagentPay = {
  "address": "As8yNFoLRYyHNCthjY3fxRPDi8F41JjobLmQUEFLJcCq",
  "metadata": {
    "name": "solagentPay",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Policy-limited payment wallets for autonomous AI agents"
  },
  "instructions": [
    {
      "name": "createAgentWallet",
      "docs": [
        "Owner creates a spending-limited wallet for an agent key, plus a token vault owned by it."
      ],
      "discriminator": [
        243,
        173,
        1,
        184,
        209,
        14,
        51,
        108
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "agent"
        },
        {
          "name": "agentWallet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "agentWallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pay",
      "docs": [
        "Agent pays a recipient from the vault, subject to the owner's policy."
      ],
      "discriminator": [
        119,
        18,
        216,
        65,
        192,
        117,
        122,
        220
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true,
          "relations": [
            "agentWallet"
          ]
        },
        {
          "name": "agentWallet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_wallet.owner",
                "account": "agentWallet"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "agentWallet"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "agentWallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updatePolicy",
      "docs": [
        "Owner changes the wallet's limits or pauses it."
      ],
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "agentWallet"
          ]
        },
        {
          "name": "agentWallet",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Owner moves funds out of the vault, bypassing the agent policy."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "agentWallet"
          ]
        },
        {
          "name": "agentWallet"
        },
        {
          "name": "mint",
          "relations": [
            "agentWallet"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "agentWallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentWallet",
      "discriminator": [
        127,
        35,
        180,
        143,
        201,
        1,
        100,
        50
      ]
    }
  ],
  "events": [
    {
      "name": "paymentSent",
      "discriminator": [
        79,
        213,
        55,
        247,
        230,
        109,
        190,
        93
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "walletPaused",
      "msg": "Agent wallet is paused by its owner"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "exceedsPerTxLimit",
      "msg": "Payment exceeds the per-transaction limit"
    },
    {
      "code": 6003,
      "name": "exceedsDailyLimit",
      "msg": "Payment exceeds the daily spending limit"
    },
    {
      "code": 6004,
      "name": "invalidPolicy",
      "msg": "Per-transaction limit cannot exceed the daily limit"
    },
    {
      "code": 6005,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "agentWallet",
      "docs": [
        "PDA seeded by `[AGENT_WALLET_SEED, owner, agent]`. Owns the token vault the agent spends from."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Funds the wallet and sets its policy."
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "Key the AI agent signs payments with."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "SPL mint the wallet pays in (e.g. USDC)."
            ],
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "docs": [
              "Largest single payment, in base units."
            ],
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "docs": [
              "Total the agent may spend per window, in base units."
            ],
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "paymentSent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agentWallet",
            "type": "pubkey"
          },
          {
            "name": "recipientTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "agentWalletSeed",
      "type": "bytes",
      "value": "[97, 103, 101, 110, 116, 95, 119, 97, 108, 108, 101, 116]"
    }
  ]
};
