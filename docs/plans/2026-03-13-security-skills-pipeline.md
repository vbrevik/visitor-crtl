# Security Skills Pipeline — Implementation Plan

**Date**: 2026-03-13
**Goal**: Build 5 new security skills that integrate into the existing STIG compliance pipeline, creating a comprehensive 10-skill security analysis system.

## Existing Skills (Complete)

| # | Skill | Tool | Layer | V-IDs Covered |
|---|-------|------|-------|---------------|
| 1 | `/static-analysis` | semgrep (19 rules) | Code/SAST | V-222425,432,536,542,543,577,578,581,585,602,603,604,605,606,607,608,609,610,642 |
| 2 | `/dast` | nuclei (14 templates, curl fallback) | Runtime/DAST | V-222577,596,597,602,610 |
| 3 | `/stig-compliance` | Claude semantic | All | All 65+ V-IDs |

## New Skills (To Build)

### Skill 4: `/secret-scan` — Priority 1

**Tool**: Gitleaks
**Layer**: Code security (git history)
**Effort**: ~1 hour
**Why first**: Lowest effort, immediate security value. Your project has `admin:admin` and `test1234` in source.

| Component | Detail |
|-----------|--------|
| **What it scans** | Full git history + current diff for leaked secrets |
| **V-IDs** | V-222642 (CAT I — no embedded auth data), V-222543 (CAT I — encrypted transmission) |
| **Complements** | `/static-analysis` rule `stig-config-hardcoded-secret` catches current code; this catches git history |
| **Integration** | Pipeline evidence → `/stig-compliance` with `Source: gitleaks (deterministic)` |
| **Air-gap** | Fully offline — no network needed |

**Structure:**
```
~/.claude/skills/secret-scan/
├── SKILL.md
├── references/
│   ├── gitleaks-setup.md
│   ├── stig-rule-mappings.md
│   └── output-formats.md
├── scripts/
│   ├── run_scan.sh
│   └── gitleaks_to_findings.py
└── assets/
    └── gitleaks.toml          # Custom rules + allowlist
```

### Skill 5: `/sca` — Priority 1

**Tool**: Syft (SBOM) + Grype (CVE matching)
**Layer**: Dependency security
**Effort**: ~2 hours
**Why P1**: No dependency scanning exists. Hundreds of transitive npm deps unaudited.

| Component | Detail |
|-----------|--------|
| **What it scans** | package.json + lock files across all workspace packages |
| **V-IDs** | V-222551 (automated vulnerability scanning — currently MANUAL in baseline) |
| **Output** | SBOM (CycloneDX) + vulnerability report + license inventory |
| **Integration** | Pipeline evidence → `/stig-compliance` with `Source: grype (deterministic)` |
| **Air-gap** | Grype DB downloadable offline, Syft fully local |

**Structure:**
```
~/.claude/skills/sca/
├── SKILL.md
├── references/
│   ├── tools-setup.md
│   ├── stig-rule-mappings.md
│   └── output-formats.md
├── scripts/
│   ├── run_sbom.sh            # Generate SBOM with Syft
│   ├── run_vuln_scan.sh       # Scan SBOM with Grype
│   ├── grype_to_findings.py   # Parse → V-ID-tagged findings
│   └── license_check.py       # Flag GPL/AGPL for gov procurement
└── assets/
    └── grype-config.yaml      # Severity thresholds, ignore list
```

### Skill 6: `/container-security` — Priority 1

**Tool**: Trivy (images + IaC) + Kubescape (K8s policy)
**Layer**: Infrastructure security
**Effort**: ~2 hours
**Why P1**: 9 Dockerfiles + K8s manifests unscanned. NATS without auth found by audit.

| Component | Detail |
|-----------|--------|
| **What it scans** | Dockerfiles, docker-compose.dev.yml, k8s/*.yaml |
| **V-IDs** | V-222548 (container builds), V-222549 (resource limits), V-222543 (TLS), V-222545 (network) |
| **Integration** | Pipeline evidence → `/stig-compliance` with `Source: trivy/kubescape (deterministic)` |
| **Air-gap** | Trivy DB downloadable, Kubescape fully offline |

**Structure:**
```
~/.claude/skills/container-security/
├── SKILL.md
├── references/
│   ├── tools-setup.md
│   ├── stig-rule-mappings.md
│   └── output-formats.md
├── scripts/
│   ├── run_trivy.sh
│   ├── run_kubescape.sh
│   ├── trivy_to_findings.py
│   └── kubescape_to_findings.py
└── assets/
    ├── trivy-policy.yaml      # Custom policies for defense context
    └── kubescape-framework.json  # STIG-mapped K8s checks
```

### Skill 7: `/threat-model` — Priority 2

**Tool**: Claude (STRIDE + LINDDUN frameworks)
**Layer**: Design security (pre-implementation)
**Effort**: ~3 hours
**Why P2**: Highest intellectual value but less deterministic. Architecture docs already exist.

| Component | Detail |
|-----------|--------|
| **What it analyzes** | Architecture docs, data flow diagrams, code structure |
| **Frameworks** | STRIDE (security threats), LINDDUN (privacy threats for GDPR) |
| **Output** | Threat report → code pointers → STIG mappings → risk register entries |
| **Integration** | Feeds into `/stig-compliance guard` as design-level constraints |
| **Air-gap** | Fully local (Claude-based, no external API) |

**Structure:**
```
~/.claude/skills/threat-model/
├── SKILL.md
├── references/
│   ├── stride-framework.md
│   ├── linddun-framework.md
│   ├── stig-threat-mappings.md
│   └── output-formats.md
└── assets/
    └── threat-report-template.md
```

### Skill 8: `/api-fuzz` — Priority 2

**Tool**: OWASP OFFAT
**Layer**: Runtime API security
**Effort**: ~2 hours
**Why P2**: Catches auth boundary gaps (public audit log queries). Needs running server.

| Component | Detail |
|-----------|--------|
| **What it tests** | API endpoints: auth bypass, input injection, schema violations, enumeration |
| **V-IDs** | V-222425 (auth), V-222606 (input validation), V-222602 (error disclosure) |
| **Integration** | Pipeline evidence → `/stig-compliance` with `Source: offat (dynamic)` |
| **Air-gap** | OFFAT runs locally, no cloud dependencies |

**Structure:**
```
~/.claude/skills/api-fuzz/
├── SKILL.md
├── references/
│   ├── offat-setup.md
│   ├── stig-rule-mappings.md
│   └── output-formats.md
├── scripts/
│   ├── run_fuzz.sh
│   └── offat_to_findings.py
└── assets/
    └── openapi-specs/         # Auto-generated or manual API specs
```

## Pipeline Integration Architecture

All skills produce the same JSON evidence format:

```json
{
  "tool": "<tool-name>",
  "scope": "<scan-scope>",
  "findings": [
    {
      "rule_id": "<tool-specific-id>",
      "v_id": "V-XXXXXX",
      "cat": "I|II|III",
      "category": "<stig-category>",
      "file": "<path-or-url>",
      "line": 0,
      "message": "<description>",
      "severity": "ERROR|WARNING",
      "snippet": "<code-or-response>"
    }
  ]
}
```

`/stig-compliance review` consumes all evidence sources and produces unified report with source attribution per finding.

## Build Order

1. `/secret-scan` (gitleaks) — build now
2. `/sca` (syft + grype) — build next
3. `/container-security` (trivy + kubescape) — build after sca
4. `/threat-model` (Claude STRIDE/LINDDUN) — Phase 2
5. `/api-fuzz` (OFFAT) — Phase 2

## Shared Conventions

- All skills use `references/stig-rule-mappings.md` for V-ID mapping tables
- All skills use `references/output-formats.md` for pipeline evidence format
- All scripts output to `/tmp/<tool>-stig-findings.*`
- All parsing scripts support `--json` flag for pipeline mode
- All skills reuse `.claude/rules/stig-profile.md` project overlay
- All skills are advisory only — never block commits or builds
