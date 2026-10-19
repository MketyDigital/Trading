"""Persistent, credential-free metadata for local MT5 terminal profiles."""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


MANIFEST_NAME = 'profiles.json'
LEGACY_CONFIG_NAME = 'mt5-connector.json'
LEGACY_LEDGER_NAME = 'mt5-connector-ledger.sqlite'
PROFILE_ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')


@dataclass(frozen=True)
class ProfilePaths:
    profile_id: str
    config_path: Path
    ledger_path: Path
    status_path: Path


@dataclass(frozen=True)
class TerminalProfile:
    profile_id: str
    label: str
    terminal_path: Path | None = None
    legacy: bool = False
    copy_role: str = 'none'
    copy_parent_profile_id: str | None = None
    copy_enabled: bool = False
    copy_lot_multiplier: float = 1.0
    copy_fixed_lot: float | None = None
    copy_symbol_map: dict[str, str] = field(default_factory=dict)


def _validate_profile_id(profile_id: str) -> str:
    value = str(profile_id or '').strip()
    if not PROFILE_ID_PATTERN.fullmatch(value):
        raise ValueError('profile id must contain only letters, numbers, underscores, or hyphens')
    return value


def profile_paths(profile: TerminalProfile, app_data_dir: Path) -> ProfilePaths:
    profile_id = _validate_profile_id(profile.profile_id)
    base = Path(app_data_dir)
    if profile.legacy:
        if profile_id != 'legacy-default':
            raise ValueError('legacy profile id must be legacy-default')
        return ProfilePaths(
            profile_id=profile_id,
            config_path=base / LEGACY_CONFIG_NAME,
            ledger_path=base / LEGACY_LEDGER_NAME,
            status_path=base / 'mt5-connector-status.json',
        )
    instance_dir = base / 'terminals' / profile_id
    return ProfilePaths(
        profile_id=profile_id,
        config_path=instance_dir / 'connector.json',
        ledger_path=instance_dir / 'ledger.sqlite',
        status_path=instance_dir / 'status.json',
    )


def _read_manifest(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        return {}
    try:
        document = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f'could not read MT5 terminal profile manifest: {exc}') from exc
    if not isinstance(document, dict):
        raise RuntimeError('MT5 terminal profile manifest is invalid')
    return document


def _manifest_profiles(manifest_path: Path) -> list[TerminalProfile]:
    document = _read_manifest(manifest_path)
    rows = document.get('profiles', [])
    if not isinstance(rows, list):
        raise RuntimeError('MT5 terminal profile manifest has an invalid profiles list')
    result = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError('MT5 terminal profile entry is invalid')
        profile_id = _validate_profile_id(row.get('profile_id'))
        if profile_id == 'legacy-default' or profile_id in seen:
            raise RuntimeError('MT5 terminal profile ids must be unique and non-legacy')
        seen.add(profile_id)
        terminal_text = str(row.get('terminal_path') or '').strip()
        result.append(TerminalProfile(
            profile_id=profile_id,
            label=str(row.get('label') or profile_id).strip()[:80],
            terminal_path=Path(terminal_text) if terminal_text else None,
            legacy=False,
            copy_role=str(row.get('copy_role') or 'none').strip().lower() if str(row.get('copy_role') or 'none').strip().lower() in {'none', 'parent', 'follower'} else 'none',
            copy_parent_profile_id=str(row.get('copy_parent_profile_id') or '').strip() or None,
            copy_enabled=bool(row.get('copy_enabled', False)),
            copy_lot_multiplier=float(row.get('copy_lot_multiplier') or 1.0),
            copy_fixed_lot=float(row['copy_fixed_lot']) if row.get('copy_fixed_lot') not in (None, '') else None,
            copy_symbol_map=validate_symbol_map(row.get('copy_symbol_map', {})),
        ))
    return result


def load_profiles(app_data_dir: Path) -> list[TerminalProfile]:
    base = Path(app_data_dir)
    manifest_path = base / MANIFEST_NAME
    document = _read_manifest(manifest_path)
    profiles = _manifest_profiles(manifest_path)
    if (base / LEGACY_CONFIG_NAME).exists() and not any(profile.profile_id == 'legacy-default' for profile in profiles):
        legacy_terminal_path = str(document.get('legacy_terminal_path') or '').strip()
        profiles.insert(0, TerminalProfile(
            profile_id='legacy-default',
            label='Existing MT5 connection',
            terminal_path=Path(legacy_terminal_path) if legacy_terminal_path else None,
            legacy=True,
        ))
    return profiles


def save_profile(profile: TerminalProfile, app_data_dir: Path) -> None:
    if profile.legacy:
        raise ValueError('legacy profile metadata is discovered from the existing connector config')
    profile_id = _validate_profile_id(profile.profile_id)
    if profile_id == 'legacy-default':
        raise ValueError('profile id is reserved for the existing connector')
    base = Path(app_data_dir)
    base.mkdir(parents=True, exist_ok=True)
    manifest_path = base / MANIFEST_NAME
    profiles = [item for item in _manifest_profiles(manifest_path) if item.profile_id != profile_id]
    profiles.append(TerminalProfile(
        profile_id=profile_id,
        label=str(profile.label or profile_id).strip()[:80],
        terminal_path=Path(profile.terminal_path) if profile.terminal_path else None,
        legacy=False,
        copy_role=profile.copy_role,
        copy_parent_profile_id=profile.copy_parent_profile_id,
        copy_enabled=profile.copy_enabled,
        copy_lot_multiplier=profile.copy_lot_multiplier,
        copy_fixed_lot=profile.copy_fixed_lot,
        copy_symbol_map=profile.copy_symbol_map,
    ))
    existing_document = _read_manifest(manifest_path)
    document = {'version': 1, 'profiles': [
        {
            'profile_id': item.profile_id,
            'label': item.label,
            'terminal_path': str(item.terminal_path) if item.terminal_path else None,
            'copy_role': item.copy_role,
            'copy_parent_profile_id': item.copy_parent_profile_id,
            'copy_enabled': item.copy_enabled,
            'copy_lot_multiplier': item.copy_lot_multiplier,
            'copy_fixed_lot': item.copy_fixed_lot,
            'copy_symbol_map': item.copy_symbol_map,
        }
        for item in profiles
    ]}
    legacy_terminal = str(existing_document.get('legacy_terminal_path') or '').strip()
    if legacy_terminal:
        document['legacy_terminal_path'] = legacy_terminal
    _write_manifest(manifest_path, document)


def validate_symbol_map(value) -> dict[str, str]:
    if value is None or value == '':
        return {}
    if isinstance(value, str):
        parsed = {}
        for line in value.splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                raise ValueError('symbol mappings must use ParentSymbol = FollowerSymbol, one per line')
            source, target = line.split('=', 1)
            parsed[source.strip()] = target.strip()
        value = parsed
    if not isinstance(value, dict):
        raise ValueError('symbol mapping must be a mapping of parent symbols to follower symbols')
    result, seen = {}, set()
    for source, target in value.items():
        source, target = str(source or '').strip(), str(target or '').strip()
        if not source or not target:
            raise ValueError('symbol mapping names cannot be empty')
        key = source.casefold()
        if key in seen:
            raise ValueError(f'duplicate parent symbol mapping: {source}')
        seen.add(key)
        result[source] = target
    return result


def update_copy_settings(profile: TerminalProfile, app_data_dir: Path, *, role='none', parent_profile_id=None, enabled=False, lot_multiplier=1.0, fixed_lot=None, symbol_map=None) -> TerminalProfile:
    role = str(role or 'none').strip().lower()
    if role not in {'none', 'parent', 'follower'}:
        raise ValueError('copy role must be none, parent, or follower')
    parent = str(parent_profile_id or '').strip() or None
    if role == 'follower' and (not parent or parent == profile.profile_id):
        raise ValueError('follower copy requires a different parent profile')
    if role != 'follower':
        parent = None
        enabled = False
    try:
        multiplier = float(lot_multiplier)
    except (TypeError, ValueError) as exc:
        raise ValueError('copy lot multiplier must be positive') from exc
    if multiplier <= 0:
        raise ValueError('copy lot multiplier must be positive')
    fixed = None if fixed_lot in (None, '') else float(fixed_lot)
    if fixed is not None and fixed <= 0:
        raise ValueError('copy fixed lot must be positive')
    updated = TerminalProfile(profile.profile_id, profile.label, profile.terminal_path, profile.legacy, role, parent, bool(enabled), multiplier, fixed,
                              validate_symbol_map(symbol_map if symbol_map is not None else profile.copy_symbol_map))
    save_profile(updated, app_data_dir)
    return updated


def bind_legacy_terminal(terminal_path: Path, app_data_dir: Path) -> None:
    """Bind the old one-terminal config to a selected executable without moving it."""
    base = Path(app_data_dir)
    if not (base / LEGACY_CONFIG_NAME).exists():
        raise ValueError('there is no existing single-terminal connector profile to bind')
    terminal = Path(terminal_path)
    if terminal.name.casefold() != 'terminal64.exe':
        raise ValueError('select the MetaTrader 5 terminal64.exe file')
    base.mkdir(parents=True, exist_ok=True)
    manifest_path = base / MANIFEST_NAME
    document = _read_manifest(manifest_path)
    document['version'] = 1
    document['profiles'] = document.get('profiles', [])
    document['legacy_terminal_path'] = str(terminal)
    _write_manifest(manifest_path, document)


def _write_manifest(manifest_path: Path, document: dict) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix='profiles.json.', suffix='.tmp', dir=manifest_path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(document, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, manifest_path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
