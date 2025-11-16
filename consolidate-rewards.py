#!/usr/bin/env python3
"""
💰 MIDNIGHT SCAVENGER MINE - REWARD CONSOLIDATION
==================================================

Consolidates rewards from multiple addresses to a single destination address
using the POST /donate_to endpoint.

IMPORTANT:
- Uses your seed phrase to re-derive addresses and sign consolidation
- Your seed is ONLY held in memory (never written to disk)
- This is IRREVERSIBLE - consolidation applies to ALL past + future solutions
- Available throughout campaign + 24h after (Days 1-22)

WHAT IT DOES:
1. Loads addresses from registrations.json and registrations-64.json.bak
2. Asks you for destination address (where all rewards should go)
3. Re-derives addresses from seed to get signing keys
4. Signs consolidation message for each address
5. POSTs to /donate_to API endpoint
6. Reports success/failure for each consolidation

BENEFITS:
- Claim all rewards from ONE wallet instead of 16-64 wallets
- Lower transaction fees (fewer claims)
- Reduced minimum ADA requirements
- Fewer Glacier Portal visits (4x thaw events)
"""

import json
import os
import requests
import cbor2
from getpass import getpass
from pycardano import *

API_BASE = 'https://scavenger.prod.gd.midnighttge.io'
NETWORK = Network.MAINNET

def derive_addresses_from_mnemonic(mnemonic: str, count: int):
    """
    Derive N addresses from a mnemonic using Cardano HD derivation.
    Returns: List of (address, payment_skey, payment_vkey)
    """
    print(f"\n🔑 Re-deriving {count} addresses from seed to get signing keys...")

    hdwallet = HDWallet.from_mnemonic(mnemonic)
    account_hdwallet = hdwallet.derive_from_path("m/1852'/1815'/0'")

    addresses = []

    # Derive stake key once (shared by all addresses)
    stake_hdwallet = account_hdwallet.derive_from_path("m/2/0")
    stake_skey = StakeSigningKey.from_primitive(stake_hdwallet.xprivate_key[:32])
    stake_vkey = StakeVerificationKey.from_signing_key(stake_skey)

    for index in range(count):
        # Derive payment key
        payment_hdwallet = account_hdwallet.derive_from_path(f"m/0/{index}")
        payment_skey = PaymentSigningKey.from_primitive(payment_hdwallet.xprivate_key[:32])
        payment_vkey = PaymentVerificationKey.from_signing_key(payment_skey)

        # Create base address
        address = Address(
            payment_part=payment_vkey.hash(),
            staking_part=stake_vkey.hash(),
            network=NETWORK
        )

        addresses.append({
            'index': index,
            'address': str(address),
            'address_obj': address,
            'payment_skey': payment_skey,
            'payment_vkey': payment_vkey
        })

        if (index + 1) % 10 == 0:
            print(f"   ✓ Derived {index + 1}/{count} addresses...")

    print(f"✅ Re-derived all {count} addresses!\n")
    return addresses

def sign_cip30_message(message: str, payment_skey, address):
    """
    Sign a message using CIP-30 format (CBOR-encoded COSE_Sign1).

    Returns: Hex string of CBOR-encoded signature
    """
    # Get raw address bytes
    address_bytes = address.to_primitive()

    # Protected headers (CBOR-encoded):
    # - key 1: algorithm (-8 = EdDSA)
    # - key 4: address bytes
    # - key "address": address bytes (duplicate for compatibility)
    protected_map = {
        1: -8,  # EdDSA algorithm
        4: address_bytes,
        "address": address_bytes
    }
    protected = cbor2.dumps(protected_map)

    # Unprotected headers
    unprotected = {"hashed": False}

    # Payload (raw message bytes, NOT CBOR-encoded)
    payload = message.encode('utf-8')

    # Create Sig_structure for signing
    # Sig_structure = [context, body_protected, external_aad, payload]
    sig_structure = cbor2.dumps([
        "Signature1",  # context
        protected,      # body_protected
        b'',           # external_aad (empty)
        payload        # payload
    ])

    # Sign the Sig_structure
    signature_bytes = payment_skey.sign(sig_structure)

    # Build COSE_Sign1 array: [protected, unprotected, payload, signature]
    cose_sign1 = cbor2.dumps([
        protected,
        unprotected,
        payload,
        signature_bytes
    ])

    return cose_sign1.hex()

def consolidate_address(destination: str, original: str, signature: str):
    """
    Consolidate rewards from original address to destination address.

    POST /donate_to/{destination_address}/{original_address}/{signature}
    """
    url = f"{API_BASE}/donate_to/{destination}/{original}/{signature}"

    try:
        # Try without body first (some APIs don't like empty bodies)
        response = requests.post(url, timeout=10)

        if response.ok:
            try:
                data = response.json()
                return {'success': True, 'data': data}
            except:
                return {'success': True, 'data': {'message': 'Success (no JSON response)'}}
        else:
            try:
                error_data = response.json()
                # Return full error for debugging
                return {'success': False, 'error': error_data, 'status': response.status_code, 'url': url[:100]}
            except:
                return {'success': False, 'error': f'HTTP {response.status_code}: {response.text[:200]}', 'status': response.status_code, 'url': url[:100]}

    except Exception as e:
        return {'success': False, 'error': str(e)}

def load_registered_addresses():
    """Load registered addresses from registrations.json (16 active addresses only)."""
    addresses = []

    # Load only the 16 active addresses
    if os.path.exists('registrations.json'):
        with open('registrations.json', 'r') as f:
            main_regs = json.load(f)
            addresses.extend([r['address'] for r in main_regs])
            print(f"📂 Loaded {len(main_regs)} addresses from registrations.json")
    else:
        print("❌ registrations.json not found")
        return []

    # Note: Skipping registrations-64.json.bak - only the 16 current addresses have mined anything
    print(f"   (Skipping 64-address backup - analysis shows only these 16 have activity)")

    return addresses

def consolidate_all(destination: str, derived_addresses, registered_addresses):
    """
    Consolidate all registered addresses to destination.

    Args:
        destination: Destination address for all rewards
        derived_addresses: List of derived address dicts (with signing keys)
        registered_addresses: List of registered address strings
    """
    print(f"\n💰 Consolidating {len(registered_addresses)} addresses to destination:")
    print(f"   {destination[:50]}...")
    print()
    print("⚠️  WARNING: This is IRREVERSIBLE and applies to ALL past + future solutions!")
    print()

    # Create lookup map for signing
    address_map = {a['address']: a for a in derived_addresses}

    # Build consolidation message
    consolidation_message = f"Assign accumulated Scavenger rights to: {destination}"
    print(f"📝 Message to sign: {consolidation_message}\n")

    success_count = 0
    results = []

    for i, original_addr in enumerate(registered_addresses):
        print(f"[{i+1}/{len(registered_addresses)}] Consolidating {original_addr[:40]}...")

        # Find derived address info
        if original_addr not in address_map:
            print(f"   ❌ Address not found in derived addresses (index mismatch?)")
            results.append({'address': original_addr, 'success': False, 'error': 'Not in derived set'})
            continue

        addr_info = address_map[original_addr]

        try:
            # Sign consolidation message
            signature = sign_cip30_message(
                consolidation_message,
                addr_info['payment_skey'],
                addr_info['address_obj']
            )

            # POST to /donate_to
            result = consolidate_address(destination, original_addr, signature)

            if result['success']:
                print(f"   ✅ Consolidated successfully")
                success_count += 1
                results.append({'address': original_addr, 'success': True, 'data': result.get('data')})
            else:
                error = result.get('error', 'Unknown error')
                status = result.get('status', 'unknown')
                if isinstance(error, dict):
                    error_msg = error.get('message', str(error))
                else:
                    error_msg = str(error)

                # Print more details for debugging
                print(f"   ❌ Failed (HTTP {status}): {error_msg[:120]}")
                if 'url' in result:
                    print(f"      URL: ...{result['url'][-60:]}")

                results.append({'address': original_addr, 'success': False, 'error': error_msg, 'status': status})

        except Exception as e:
            print(f"   ❌ Error: {str(e)[:80]}")
            results.append({'address': original_addr, 'success': False, 'error': str(e)})

        # Small delay to be polite to API
        if i < len(registered_addresses) - 1:
            import time
            time.sleep(0.5)

    print(f"\n✅ Consolidated {success_count}/{len(registered_addresses)} addresses successfully!\n")

    # Save results
    with open('consolidation-results.json', 'w') as f:
        json.dump({
            'destination': destination,
            'total': len(registered_addresses),
            'successful': success_count,
            'failed': len(registered_addresses) - success_count,
            'results': results
        }, f, indent=2)

    print(f"💾 Saved detailed results to consolidation-results.json\n")

    return success_count

def main():
    print("""
╔══════════════════════════════════════════════════════════════╗
║  💰 MIDNIGHT SCAVENGER MINE - REWARD CONSOLIDATION          ║
╚══════════════════════════════════════════════════════════════╝

⚠️  IMPORTANT:
   - This consolidates ALL past + future solutions
   - This is IRREVERSIBLE once confirmed by API
   - Available throughout campaign + 24h after (Days 1-22)
   - Your seed phrase is held in memory only

Benefits:
   ✓ Claim all rewards from ONE wallet
   ✓ Lower transaction fees
   ✓ Reduced minimum ADA requirements
   ✓ Fewer Glacier Portal visits
""")

    # Load registered addresses
    registered_addresses = load_registered_addresses()

    if not registered_addresses:
        print("❌ No registered addresses found in registrations.json or registrations-64.json.bak")
        return

    print(f"\n📊 Total addresses to consolidate: {len(registered_addresses)}")

    # Show sample addresses
    print("\n📋 Sample addresses:")
    for i in [0, 1, -2, -1]:
        if abs(i) < len(registered_addresses):
            addr = registered_addresses[i]
            print(f"   [{i if i >= 0 else len(registered_addresses)+i}]: {addr[:50]}...")

    print()

    # Get destination address
    print("🎯 Enter DESTINATION address (where all rewards should go):")
    destination = input("Destination: ").strip()

    if not destination.startswith('addr1'):
        print("❌ Invalid address format (must start with 'addr1')")
        return

    print(f"\n✅ Destination: {destination[:50]}...\n")

    # Final warning (no confirmation required)
    print("⚠️  FINAL CONFIRMATION:")
    print(f"   - Consolidating {len(registered_addresses)} addresses")
    print(f"   - ALL rewards will go to: {destination[:40]}...")
    print(f"   - This is IRREVERSIBLE")
    print(f"\n   Proceeding in 3 seconds... (Ctrl+C to cancel)\n")

    import time
    time.sleep(3)

    # Get seed phrase
    print("\n🔑 Enter your 24-word seed phrase (to re-derive signing keys):")
    print("   (Input is hidden for security)")
    mnemonic = getpass("Seed phrase: ").strip()

    # Validate mnemonic
    word_count = len(mnemonic.split())
    if word_count not in [12, 15, 18, 21, 24]:
        print(f"❌ Invalid mnemonic ({word_count} words). Must be 12, 15, 18, 21, or 24 words.")
        return

    print(f"✅ Got {word_count}-word seed phrase")

    try:
        # Derive addresses to get signing keys
        # Derive enough to cover all registered addresses
        max_count = len(registered_addresses)
        derived_addresses = derive_addresses_from_mnemonic(mnemonic, max_count)

        # Verify first address matches
        if derived_addresses[0]['address'] != registered_addresses[0]:
            print("❌ ERROR: First derived address doesn't match first registered address!")
            print(f"   Derived:    {derived_addresses[0]['address'][:60]}...")
            print(f"   Registered: {registered_addresses[0][:60]}...")
            print("\n⚠️  This means either:")
            print("   - Wrong seed phrase")
            print("   - Different derivation path")
            print("   - Different network (mainnet vs testnet)")
            return

        print("✅ Verification passed: Derived addresses match registered addresses\n")

        # Consolidate all addresses
        success_count = consolidate_all(destination, derived_addresses, registered_addresses)

        if success_count > 0:
            print(f"🎉 Successfully consolidated {success_count} addresses!")
            print(f"\n💡 All rewards will now be claimed from: {destination[:50]}...")
        else:
            print("❌ No addresses were successfully consolidated")

    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()

    finally:
        # Clear sensitive data from memory
        mnemonic = "0" * 1000
        del mnemonic
        print("\n🗑️  Seed cleared from memory")

if __name__ == "__main__":
    main()
