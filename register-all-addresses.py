#!/usr/bin/env python3
"""
🔐 MIDNIGHT SCAVENGER MINE - MASS ADDRESS REGISTRATION
======================================================

This script registers 100 Cardano addresses with the Midnight Scavenger Mine API.

IMPORTANT:
- Uses your seed phrase to derive addresses and sign registration
- Your seed is ONLY held in memory (never written to disk)
- DELETE THIS FILE after successful registration

WHAT IT DOES:
1. Derives 100 addresses from your seed phrase
2. Fetches registration message from Midnight API
3. Signs message with proper CIP-30 format
4. Registers each address with the API
5. Saves successful registrations to registrations.json
"""

import json
import hashlib
import os
import requests
import cbor2
from getpass import getpass
from pycardano import *

API_BASE = 'https://scavenger.prod.gd.midnighttge.io'
NETWORK = Network.MAINNET

def derive_addresses_from_mnemonic(mnemonic: str, count: int = 100):
    """
    Derive N addresses from a mnemonic using Cardano HD derivation.
    Returns: List of (address, payment_skey, payment_vkey)
    """
    print(f"\n🔑 Deriving {count} addresses from seed...")

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
            'address_obj': address,  # Keep the Address object for signing
            'payment_skey': payment_skey,
            'payment_vkey': payment_vkey
        })

        if (index + 1) % 10 == 0:
            print(f"   ✓ Derived {index + 1}/{count} addresses...")

    print(f"✅ Derived all {count} addresses!\n")
    return addresses

def get_registration_message():
    """Fetch the registration message from Midnight API."""
    print("📡 Fetching registration message from API...")
    response = requests.get(f"{API_BASE}/TandC")
    data = response.json()
    message = data['message']
    print(f"✅ Got message: {message[:80]}...\n")
    return message

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

def register_address(address: str, signature: str, pubkey: str):
    """Register an address with the Midnight API."""
    url = f"{API_BASE}/register/{address}/{signature}/{pubkey}"

    try:
        response = requests.post(url, json={}, timeout=10)

        # Check for rate limiting
        if response.status_code == 429:
            retry_after = response.headers.get('Retry-After', 'unknown')
            return {'success': False, 'error': f'Rate limited (retry after: {retry_after})', 'rate_limited': True}

        if response.ok:
            try:
                return {'success': True, 'data': response.json()}
            except:
                return {'success': True, 'data': {'message': 'Registered (no JSON response)'}}
        else:
            try:
                return {'success': False, 'error': response.json(), 'status': response.status_code}
            except:
                return {'success': False, 'error': f'HTTP {response.status_code}: {response.text[:100]}', 'status': response.status_code}

    except Exception as e:
        return {'success': False, 'error': str(e)}

def register_all_addresses(addresses, message):
    """Register all addresses with the API."""
    print(f"📝 Registering {len(addresses)} addresses with Midnight API...")
    print("   (This may take several minutes with rate limiting)\\n")

    # Load existing registrations to avoid re-registering
    temp_file = 'registrations-partial.json'
    registrations = []
    if os.path.exists(temp_file):
        try:
            registrations = json.load(open(temp_file, 'r'))
            registered_addrs = set(r['address'] for r in registrations)
            print(f"📂 Found {len(registrations)} previously registered addresses, will skip them\\n")
        except:
            pass
    else:
        registered_addrs = set()

    success_count = len(registrations)

    for i, addr_info in enumerate(addresses):
        address = addr_info['address']  # String for display/API
        address_obj = addr_info['address_obj']  # Object for signing
        payment_skey = addr_info['payment_skey']
        payment_vkey = addr_info['payment_vkey']

        print(f"[{i+1}/{len(addresses)}] Registering {address[:30]}...")

        # Skip if already registered
        if address in registered_addrs:
            print(f"   ⏭️  Already registered, skipping")
            continue

        try:
            # Sign the registration message
            signature = sign_cip30_message(message, payment_skey, address_obj)
            pubkey = payment_vkey.to_primitive().hex()

            # Register with API
            result = register_address(address, signature, pubkey)

            if result['success']:
                print(f"   ✅ Registered successfully")

                reg_entry = {
                    'address': address,
                    'signature': signature,
                    'pubkey': pubkey
                }
                registrations.append(reg_entry)
                registered_addrs.add(address)

                # Save immediately to temp file
                with open(temp_file, 'w') as f:
                    json.dump(registrations, f, indent=2)

                success_count += 1
            else:
                # Handle both dict and string errors
                error = result.get('error', 'Unknown error')
                if isinstance(error, dict):
                    error_msg = error.get('message', str(error))
                else:
                    error_msg = str(error)
                print(f"   ❌ Failed: {error_msg[:60]}")

        except Exception as e:
            print(f"   ❌ Error: {str(e)[:60]}")

        # Rate limiting: 2 seconds between registrations (to be safe)
        if i < len(addresses) - 1:
            import time
            time.sleep(2)

    print(f"\\n✅ Registered {success_count}/{len(addresses)} addresses!\\n")
    return registrations

def main():
    print("""
╔══════════════════════════════════════════════════════════════╗
║  🔐 MIDNIGHT SCAVENGER MINE - MASS REGISTRATION             ║
╚══════════════════════════════════════════════════════════════╝

⚠️  SECURITY WARNING:
   - Your seed phrase will be held in memory only
   - DELETE THIS FILE after successful registration
   - Run offline if paranoid (won't work - needs API access)

This will:
1. Derive 100 addresses from your seed
2. Sign registration for each with proper CIP-30 format
3. Register all addresses with Midnight API
4. Save to registrations.json
""")

    # Get user confirmation
    confirm = input("Ready to proceed? (yes/no): ").strip().lower()
    if confirm != 'yes':
        print("❌ Aborted.")
        return

    # Get seed phrase
    print("\\n🔑 Enter your 24-word seed phrase:")
    print("   (Input is hidden for security)")
    mnemonic = getpass("Seed phrase: ").strip()

    # Validate mnemonic
    word_count = len(mnemonic.split())
    if word_count not in [12, 15, 18, 21, 24]:
        print(f"❌ Invalid mnemonic ({word_count} words). Must be 12, 15, 18, 21, or 24 words.")
        return

    print(f"✅ Got {word_count}-word seed phrase\\n")

    # Ask how many addresses
    count_input = input("How many addresses to register? (default: 100): ").strip()
    count = int(count_input) if count_input else 100

    if count < 1 or count > 1000:
        print("❌ Count must be between 1 and 1000")
        return

    try:
        # Derive addresses
        addresses = derive_addresses_from_mnemonic(mnemonic, count)

        # Show first and last for verification
        print("📋 Sample addresses:")
        print(f"   Address 0:  {addresses[0]['address'][:50]}...")
        if count > 1:
            print(f"   Address {count-1}: {addresses[-1]['address'][:50]}...")
        print()

        # Get registration message
        message = get_registration_message()

        # Register all addresses
        registrations = register_all_addresses(addresses, message)

        if len(registrations) > 0:
            # Check if registrations.json already exists
            old_file = 'registrations.json'
            temp_file = 'registrations-partial.json'
            output_file = 'registrations-new.json'

            # Remove temp file since we're done
            if os.path.exists(temp_file):
                os.remove(temp_file)

            if os.path.exists(old_file):
                print(f"⚠️  Found existing {old_file}")

                # Load and compare addresses
                with open(old_file, 'r') as f:
                    old_registrations = json.load(f)

                # Compare first few addresses
                matches = 0
                for i in range(min(3, len(old_registrations), len(registrations))):
                    if old_registrations[i]['address'] == registrations[i]['address']:
                        matches += 1

                print(f"   ✓ Verified {matches}/{min(3, len(old_registrations), len(registrations))} addresses match")
                print(f"   Saving new registrations to {output_file}")
                print(f"   (Review and manually rename to {old_file} if satisfied)")
            else:
                output_file = old_file

            with open(output_file, 'w') as f:
                json.dump(registrations, f, indent=2)

            print(f"💾 Saved {len(registrations)} registrations to {output_file}")
            print()
            print("✅ Done! Your addresses are now registered and ready to mine!")

            if output_file != old_file:
                print(f"\n📝 Next steps:")
                print(f"   1. Verify addresses match: diff {old_file} {output_file}")
                print(f"   2. If good: mv {output_file} {old_file}")
        else:
            print("❌ No addresses were successfully registered")

    except Exception as e:
        print(f"\\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()

    finally:
        # Clear sensitive data from memory
        mnemonic = "0" * 1000
        del mnemonic
        print("\\n🗑️  Seed cleared from memory")

if __name__ == "__main__":
    main()
