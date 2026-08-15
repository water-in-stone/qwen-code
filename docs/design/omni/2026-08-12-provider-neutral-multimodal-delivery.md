# Provider-neutral Omni ingestion and multimodal delivery

## Status

- Status: Proposed, revision 27; audit stopped, not implementation-ready
- Audit state, 2026-08-14: the last complete three-agent result is Round 26,
  which was not clean. Revision 27 incorporates those findings, but Round 27
  was interrupted before any valid three-agent result and is not an approval.
- Target branch: `omni-experiment`
- Roadmap: [#8197](https://github.com/QwenLM/qwen-code/issues/8197)
- Related slices: [#8184](https://github.com/QwenLM/qwen-code/issues/8184),
  [#8186](https://github.com/QwenLM/qwen-code/issues/8186),
  [#8187](https://github.com/QwenLM/qwen-code/issues/8187), and
  [#8188](https://github.com/QwenLM/qwen-code/issues/8188)
- Authoritative source baseline, refreshed 2026-08-12:
  `upstream/omni/s5-memory@d9eb5e37b004241ec5e82db2a3c8b9e55761b0b0`
- Scope: image, audio, and video input in TUI and ACP. PDF follows the existing
  converter path and is not changed by this proposal.

The target branch must first integrate the complete 19-commit S5 stack between
`upstream/omni-experiment@a83cf89eb1` and the source baseline above. That stack
already implements three-level File/FileVersion/content identity, the session
resource registry, active and passive recall, policy-result collection and
reuse, collision-safe policy artifacts, duration guards, and real execution
windows. This proposal extends that implementation; it does not rebuild S5 from
the older S5a snapshot on local `omni-memory@458affb860`.

This design is a controlled revision of the earlier
[recognition](../2026-07-29-multimodal-file-recognition-and-metadata.md),
[policy](../2026-07-29-omni-multimodal-policy-orchestration.md),
[Memory](../2026-07-29-omni-multimodal-memory.md),
[managed storage](../2026-07-30-omni-managed-media-storage.md), and
[S5a](./2026-08-09-s5a-minimal-media-memory-recall.md) designs. It specifically
supersedes these earlier conclusions:

- all Omni delivery must use DashScope and `oss://`;
- Omni media must never use a validated inline representation;
- a local source file stays outside managed object storage;
- a session `resourceId` may be treated as durable conversation identity.

Their recognition, fixed-policy-before-transport-guard ordering, policy
atomicity, disclosure, derivation lineage, storage recovery, and Memory privacy
constraints remain in force unless this document explicitly narrows them.

## 1. Decision summary

The implementation separates provider-neutral managed media from request-time
delivery without inventing a universal upload protocol:

1. at new-conversation creation, choose immutable managed or legacy mode from
   trust, Omni enablement, and code-owned route availability—not from the first
   attachment's eventual sniff result; a legacy conversation is never upgraded;
2. establish a candidate native-media or statically complete preprocessing
   route before any read; otherwise enter the exact pre-change per-media path
   without changing conversation mode;
3. create one bounded private snapshot, sniff it, and re-prove the exact route
   before CAS, Memory, policy, or provider side effects;
4. recognize that immutable snapshot and atomically commit the existing S5
   File/FileVersion fact with its object record/binding;
5. run S4 fixed preprocessing policies against that exact version, committing
   every derivative as a separate version with lineage;
6. build the ordered delivery group, then apply adapter transport guards and
   guard policies to the final candidates;
7. materialize candidates for the actual provider request;
8. construct one immutable SDK `Request` snapshot at the injected `fetch`
   boundary, validate its bounded bytes or branded streaming descriptor on every
   physical attempt, then send that exact snapshot under adapter-owned deadline,
   response-admission, and terminal-state rules.

The first implementation has two code-owned media adapters:

- `dashscope-oss-v1`, preserving the currently implemented canonical-China
  public Qwen-Omni upload shape as disabled candidate code with strict
  credential/endpoint checks; it is enabled only after exact public inference
  E2E evidence, because the current Qwen-Omni documentation uses workspace
  endpoints;
- `minimax-openai-inline-v1`, accepting only exact `MiniMax-M3` on one of the
  two official endpoints and emitting only verified image/video data forms. It
  never calls a DashScope upload endpoint and never emits `oss://`.

Provider tools that make their own external request, such as the audio
transcription policy, have a typed processor profile and separate egress
context; they never borrow the downstream model's provider context or
credential.

There is no model-name guess, settings-defined transport profile, or implicit
adapter. A selected route with neither an enabled verified native profile nor a
statically complete authorized preprocessing route follows the complete
pre-change compatibility path and creates no new capture, URL download, CAS,
Memory, policy, or upload side effect. Other providers can be added only by a
new code-owned profile and evidence.

## 2. Problem

The current `isOmniDeliveryActive()` gate answers two independent questions at
once:

1. should Qwen Code recognize, hash, apply policy to, and remember this media;
2. may the active route use the DashScope temporary upload API and deliver its
   `oss://` result.

Because the gate requires a static API key, an explicit DashScope base URL, and
a DashScope-compatible route, MiniMax can receive an image through the old
inline converter while Omni recognition and Memory never run. Removing the
hostname check would instead risk sending another provider's credential to a
DashScope upload protocol and returning an unresolvable `oss://` reference.

The current `generationConfig.modalities` booleans also express only semantic
acceptance. They do not prove the wire object, MIME allowlist, reference kind,
role placement, model ID, per-file/request limit, tool/stream compatibility,
endpoint path, upload origin, or credential owner.

## 3. Goals and non-goals

### 3.1 Goals

- Preserve complete S5 identity, provenance, recall, and reuse while separating
  capture/Memory from DashScope upload for enabled code-owned profiles.
- Select delivery from each actual provider request, including primary, Vision
  Bridge, subagent, and external policy-processor requests when that consumer has
  a verified managed physical-client adapter.
- Preserve the current canonical-China Qwen-Omni behavior behind an evidence
  gate and add exact MiniMax M3 image/video as the first non-Qwen-Omni verified
  route; other DashScope regions remain legacy until they have an explicit
  upload authority profile.
- Cover local paths, explicit user HTTPS references, and inline bytes at TUI
  and ACP user-input/tool-result boundaries.
- Preserve image-overview behavior as an explicit managed S4 derivative rather
  than silently switching MiniMax to raw images.
- Persist ordered provider-neutral conversation groups and re-materialize them
  for the current provider without persisting session or provider capabilities.
- Prove the final physical request URL, method, model, media fields, headers,
  credential owner, and request-wide limits before every network attempt.

### 3.2 Non-goals

- A universal upload API or user-configurable transport profile.
- Managed Anthropic/Gemini physical requests in the first slice. Their current
  SDK integrations lack the same request-local final-fetch boundary; ASR-to-text
  or media routed to them retains legacy/unavailable behavior until a separate
  protocol adapter proves request, response, retry, logging, and credential
  isolation without global fetch mutation.
- MiniMax Files, Gemini Files, Anthropic Files, or arbitrary provider uploads.
- Direct provider fetch of user/tool URLs. Explicit user URLs are localized;
  tool-provided URLs are not newly fetched in the first slice.
- Changing PDF. It remains on the existing converter contract and is not
  claimed as provider-profile-verified here.
- Web Shell direct attachments. ACP support does not prove the Web Shell ingress
  and E2E path.
- Project-wide media discovery. A fresh session receives a handle only after the
  user explicitly re-references a resource; the model never searches by path or
  SHA-256.
- Treating `raw-resource-v1` as provider billing or exact context use. It is a
  provider-neutral raw-resource complexity heuristic for explicit Omni policy.
- Fetching a tool-result `fileData`/resource-link URL or adding a new approval
  interaction in this slice.
- Upgrading, importing, or managed-forking an existing legacy transcript in
  place. Persistent v2 conversation state begins only in a newly created managed
  conversation.

## 4. Required invariants

1. **One identity per immutable version.** Recognition, SHA-256, metadata,
   policy input, and selected delivery bytes refer to the same immutable source
   or derivative. A derivative has its own identity and a lineage edge.
2. **File provenance is not byte deduplication.** Two logical occurrences with
   equal bytes remain separate S5 Files/provenance while sharing one CAS object
   and reusable policy computation.
3. **Session capability never persists.** `resourceId` is random, opaque, and
   valid only in its issuing `MediaResourceRegistry`. Durable history stores a
   version reference, never a session handle; model-echoed handles are replaced
   at every recording/checkpoint boundary by harness-owned semantic pointers.
4. **Best-effort Memory is honest.** Memory failure may deliver an immutable
   request-local object and run an explicitly ephemeral policy branch, but it
   creates no fake FileVersion, reusable execution, or resumable media history.
5. **Fixed policy precedes transport guard.** Successful source recognition is
   recorded before delivery policy. A later omit/reject does not erase the true
   recognition fact. Adapter caps apply to final candidates and may invoke S4
   transport-guard policies first.
6. **One context per physical consumer.** A logical turn can create separate
   immutable contexts for downstream inference, Vision Bridge, subagents, and
   policy processors. Credentials and endpoints never cross them.
7. **Explicit capability and authorization.** Effective support intersects
   semantic modality, exact model ID, code-owned profile, converter, placement,
   full endpoint scope, and credential authorization. `providerId`, `AuthType`,
   or "OpenAI-compatible" alone proves none of these.
8. **No external source URL at media egress.** HTTPS input is an external source,
   not a provider handle. Only an adapter-issued, scope-checked, unexpired handle
   can occupy a structured media-reference field.
9. **Policy verdicts fail closed.** Ingestion safety, adapter guard, policy, and
   final request rejection never fall back to a less constrained media form.
10. **Wire references are ephemeral.** Data URLs, `oss://`, provider file IDs,
    and provider URLs are request materializations, not conversation identity,
    and never cross provider/endpoint/credential scope.
11. **No-candidate-route and untrusted media paths are unchanged.** Within the
    conversation mode selected before its first append, they enter the old media
    path before any new source read, media-state write, policy, localization, or
    network effect. An untrusted/Omni-disabled new conversation selects legacy
    mode and creates no managed lifecycle state. A
    false-positive local/inline candidate may add only a bounded private staging
    snapshot beyond the already selected conversation lifecycle; failed exact
    proof deletes it before File/CAS, Memory, policy, or network effects.
    Disabling a media adapter does not disable a separately
    authorized, statically complete text/omission preprocessing route; the
    global `omni.enabled` gate is the zero-side-effect rollback.
12. **Project state is cross-process safe.** Memory mutation, CAS promotion,
    conversation roots, session leases, and GC share one project lock protocol;
    no process can sweep another process's live object.
13. **Recall remains read-only.** Storage liveness is an independent best-effort
    journal. A journal failure never changes active/passive recall results or
    adds a third S5 collection trigger.

## 5. Core model

### 5.1 Protocol, authentication, provider, and endpoint

Wire protocol and authentication are separate:

```ts
type MediaWireProtocol =
  | 'openai-chat'
  | 'anthropic-messages'
  | 'gemini-generate-content';

interface ResolvedProviderRoute {
  providerId: string;
  wireProtocol: MediaWireProtocol;
  authType: AuthType;
  modelId: string;
  endpointScopeId: string;
  credentialSourceOwnerId: string;
  credentialInstanceId: string;
  tlsVerification: 'required';
  physicalClientAdapterId: 'openai-managed-v1';
  responseProfileId: 'minimax-chat-v1' | 'dashscope-qwen-omni-v1';
  responseProfileVersion: 1;
}

type CandidateProviderRoute = Omit<
  ResolvedProviderRoute,
  'credentialInstanceId'
> & { credentialHandle: 'secure-unread-opaque-handle' };
```

Qwen OAuth and a static DashScope key can share an OpenAI wire protocol while
using different authorization. Gemini API key and Vertex can share the Gemini
wire protocol while using different endpoints and credentials.
`credentialSourceOwnerId` identifies the configured secret slot. The separate
`credentialInstanceId` is
`HMAC(projectKey, authScheme + "\0" + exactNormalizedCredentialBytes)` and
changes whenever the credential value changes, even under the same environment
variable. Neither identifier nor the raw secret is logged or model-visible.
Normalized credential bytes must be nonempty and at most `16_384` UTF-8 bytes.
Upload policy, issued-upload scope, delivery cache, and every final request bind
the instance ID; two slots holding exactly the same normalized credential share
an instance, while a rotation invalidates all old handles. At every external
side-effect checkpoint the secure credential handle recomputes the instance ID;
a changed or unavailable value aborts before I/O.

The zero-effect media candidate gate checks only that the configured source has
a non-placeholder secure credential; it does not initialize or mutate media
identity merely to hash it. A managed conversation already has its bounded
project/session authority from creation, while a legacy conversation never gains
that authority in place. Candidate staging/sniffing completes first in the
private transient domain described in Section 6.1. Only after the whole-plan
exact barrier passes may the service derive/freeze the credential instance ID,
reserve media capacity, and proceed to CAS/Memory/policy/provider work. A
no-candidate or false-positive plan therefore adds no File/CAS/Memory/policy/
credential state and leaves the preselected conversation lifecycle unchanged.

All first-slice code-owned managed profiles require direct certificate-verified
HTTPS. Any argv/settings/environment proxy, proxy dispatcher, custom Agent,
`QWEN_TLS_INSECURE`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or dispatcher with a
`rejectUnauthorized:false` branch makes the profile unavailable before capture.
This deliberately excludes CONNECT and `Proxy-Authorization` from the first
physical profile instead of claiming that process-global Undici diagnostics can
keep proxy credentials private. A sealed direct-transport descriptor is
revalidated at final fetch; matching only a dispatcher object identity is
insufficient. Operator-explicit processors use the same requirement. Proxy,
insecure, and self-signed endpoints retain only their pre-managed legacy
behavior and cannot receive a managed credential or media object.

Provider identity survives model installation/selection, runtime snapshots,
Vision Bridge, subagents, and hot switching. New model records persist it.
Migration of an older built-in MiniMax or ModelStudio Standard record may
restore `minimax` or `alibabaStandard` only when the tuple of exact official
base URL, wire protocol, auth configuration, environment-key owner, and
case-sensitive model ID matches that built-in definition. A name, hostname
suffix, or custom proxy is insufficient; ambiguity stays unverified.

Semantic modality settings preserve unset, explicitly true, and explicitly
false. Built-in defaults apply only to unset. False always wins; all-false is not
normalized to missing, and the MiniMax preset does not force-overwrite it.

`MediaWireProtocol` describes the long-term routing model, but managed admission
also requires a code-owned `ManagedPhysicalClientAdapter`. This revision registers
only `openai-managed-v1`. Anthropic and Gemini routes cannot satisfy candidate or
exact managed proof—even for transcript-only output—and follow their complete
legacy/unavailable path. A future adapter must own its protocol's per-call
serialization, transport injection, retry, redirect, TLS, response validation,
logging, and taint boundaries; global `fetch` monkey-patching is forbidden.

### 5.2 Code-owned transport profiles

Profiles are registered in code and settings cannot claim one:

```ts
type MediaModality = 'image' | 'audio' | 'video';
type AdapterReferenceKind =
  | 'inline-data'
  | 'adapter-remote-handle'
  | 'dashscope-oss';
type MediaPlacement = 'user' | 'split-user';
type ToolChoiceMode = 'absent' | 'auto' | 'required' | 'none';
type StreamingMode = 'required' | 'optional' | 'forbidden';

interface InferenceScope {
  id: string;
  scheme: 'https:';
  hostname: string;
  port: 443;
  basePath: string;
  requestPath: string;
  method: 'POST';
}

interface MediaTransportProfile {
  id: 'dashscope-oss-v1' | 'minimax-openai-inline-v1';
  version: 1;
  providerId: string;
  wireProtocol: MediaWireProtocol;
  responseProfileId: 'minimax-chat-v1' | 'dashscope-qwen-omni-v1';
  responseProfileVersion: 1;
  allowedAuthTypes: readonly AuthType[];
  inferenceScopes: readonly InferenceScope[];
  models: readonly MediaModelCapability[];
}

interface MediaModelCapability {
  modelId: string;
  modalities: Readonly<Partial<Record<MediaModality, MediaCapability>>>;
  request: MediaRequestConstraints;
}

interface MediaCapability {
  mimeTypes: readonly string[];
  referenceKinds: readonly AdapterReferenceKind[];
  placements: readonly MediaPlacement[];
  maxDecodedBytes: number;
  maxDurationMs: number | null;
  imageDimensions?: {
    minWidthExclusive: number;
    minHeightExclusive: number;
    maxAspectRatioInclusive: number;
  };
}

interface MediaRequestConstraints {
  maxMediaParts: number;
  maxEncodedMediaBytes: number;
  maxSerializedBodyBytes: number;
  permitsTools: boolean;
  streamingMode: StreamingMode;
  toolChoiceModes: readonly ToolChoiceMode[];
}
```

The authorization tuple includes provider, profile/version, exact model ID,
exact endpoint scope, wire protocol, allowed `AuthType`, credential source,
credential instance, and verified TLS transport.
The existing permissive `MiniMaxOpenAICompatibleProvider` hostname/suffix test
may select response parsing, but it is never profile authority.

For MiniMax v1, `providerId` is exactly `minimax`, `models` contains exactly
`MiniMax-M3`, and
`allowedAuthTypes` contains only the existing static OpenAI-compatible key
mode. The endpoint
allowlist is exactly HTTPS port 443 at `api.minimax.io` or `api.minimaxi.com`,
base path `/v1`, final path `/v1/chat/completions`, without userinfo, query, or
fragment. Redirects are rejected. First-slice media is deliberately narrow:

| Constraint                | MiniMax v1 value                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Image                     | JPEG/PNG data URL in `image_url`; `10_000_000` decoded bytes; no duration                                                           |
| Video                     | MP4 data URL in `video_url`; `50_000_000` decoded bytes; `maxDurationMs: null` because the official contract states no duration cap |
| Audio                     | Unsupported                                                                                                                         |
| `maxMediaParts`           | `4` (conservative candidate limit, not an official provider limit)                                                                  |
| `maxEncodedMediaBytes`    | `60_000_000` UTF-8 bytes across structured media fields                                                                             |
| `maxSerializedBodyBytes`  | `64_000_000` UTF-8 JSON bytes                                                                                                       |
| `permitsTools`            | `true`                                                                                                                              |
| `streamingMode`           | `optional`                                                                                                                          |
| `toolChoiceModes`         | `['absent']`; the first profile does not send `tool_choice`                                                                         |
| media + tools + streaming | candidate-supported; must pass fake and real E2E for each endpoint scope before that scope is verified                              |

The official contract says MB without promising binary MiB, so decimal values
are the safe interpretation. The full body cap means a 50,000,000-byte video
will normally fail earlier after base64/JSON expansion. The implementation tests
limit-1, limit, and limit+1 for decoded and serialized sizes.

`4` parts and `60_000_000` encoded bytes are intentionally conservative
product limits because the official schema does not publish those dimensions.
They can be changed only with a profile-version bump. The current MiniMax
OpenAPI does not declare `tool_choice`, so a request that the shared pipeline
maps to `required` or `none` is locally unavailable for profiled media; an
explicit mode can be added only after contract and real-provider evidence.
Candidate/verified state is keyed by `profileId + endpointScopeId`; passing real
E2E on `.io` never enables `.com`, or vice versa.

MOV and MKV remain outside the verified profile. Official MOV base64 uses
`video/mov` while hosted objects use `video/quicktime`; current recognition maps
MOV differently, and current EBML sniffing does not reliably distinguish MKV
from WebM. They retain pre-change compatibility diagnostics until recognition
and real-provider tests prove an exact mapping.

For every managed request, including a transcript-only request with no media
profile, user `extra_body` cannot override security-bearing top-level fields:
`model`, `messages`, `input`, `contents`, `stream`, `stream_options`, `tools`,
`tool_choice`, `n`, or any structured media field. Presence of a reserved override is
a configuration verdict before capture and fails closed rather than falling
back to an unmanaged media route. The final validator independently proves the
serialized `model` equals the frozen case-sensitive `modelId`; when no media
profile or processor request profile exists it also proves the final schema
contains zero structured media slots. A processor request is never classified
by that zero-media inference branch; it must match its own exact request profile.
MiniMax v1 requires `n` to be absent from the serialized request and rejects
every `extra_body.n` before capture; its response profile independently requires
exactly one choice with `index: 0`. A later profile may add request `n` only
after the official schema and both endpoint scopes prove it.

### 5.3 S5 snapshot v2, locators, and managed backing

S5 v2 uses a brokered per-user application-data namespace outside every
workspace and built-in model file/sandboxed-shell filesystem root:
`<qwen-app-data>/managed-media-v2/projects/<projectStorageId>/`. It contains
`memory-v2.json`, objects, staging, leases, sidecars, caches, and the liveness
journal. One broker catalog resolves a versioned workspace binding to
`projectStorageId`; the project ID is selected from the validated catalog row,
never guessed by enumerating directories. Neither a broker secret, resolved
directory, nor an absolute child path is stored under the workspace. V1 remains at
`.qwen/omni/memory.json` and is read-only import input. Thus an older binary can
never rename or overwrite v2 as "corrupt", and ordinary workspace file tools
cannot traverse into managed storage. The
single `memory-v2.json` transaction document keeps the existing File/
FileVersion/execution/entry graph and adds:

- stable project storage identity and a project-local locator HMAC key;
- a versioned logical locator key on each File;
- a logically separate object catalog plus FileVersion and policy-entry
  bindings; they commit in the same atomic document but remain storage state,
  not a third S5 collection trigger;
- group-level adopting/durable root sets plus non-rooting deleting cleanup rows
  and broker session routes. Last-use availability is storage
  metadata in the separate journal, not a field or mutation trigger in S5.

The application-data root has one cross-process lock and one atomic, checksummed
`0600 broker-v1.json`. It contains the random broker key/version, workspace
binding catalog, project lifecycle rows, aggregate reservations, and physical
usage counters, plus the global conversation-generation counter and bounded
session-route rows. A nonterminal session route is a control-plane retention
blocker for its project even when the project currently has no byte root; it is
not itself a byte root and cannot resolve bytes without matching project
authority. The broker may be regenerated only when no committed project directory
exists. Once any project exists, a missing/replaced key or catalog fails managed
mode for the broker; directory enumeration is used only to reconcile physical
charges and establish corruption, never to guess a workspace mapping. Its temp/
fsync/rename crash protocol and pre-parse limits match project identity
bootstrap, and the broker key is available only to the harness service.
Handle-relative `fstat` rejects the broker document above `16_000_000` bytes;
its fatal decoder permits depth `16`, at most `256` project rows, `1_024`
versioned binding/alias rows, `256` session-route rows with at most `4_194_304`
aggregate ciphertext bytes, `8_192` aggregate reservation/retirement rows, and the same safe string/integer
rules as project authority. Canonical write validates these limits before temp
creation and rename.

The broker application-data root is code-owned and not configurable:

- Linux: the current account home from `getpwuid_r(geteuid())`, then literal
  `.local/state/qwen-code/managed-media-v2`;
- macOS: `NSApplicationSupportDirectory` for the current user, then literal
  `QwenCode/managed-media-v2`;
- Windows: `SHGetKnownFolderPath(FOLDERID_LocalAppData)` for the current user,
  then literal `QwenCode\\managed-media-v2`.

It ignores `QWEN_HOME`, `QWEN_RUNTIME_DIR`, XDG/environment home overrides,
workspace settings, and CLI output/runtime-directory flags. The native module
opens the OS-returned ancestor and creates each literal child with owner-only
permissions (`0700` on POSIX, current-user-only DACL on Windows), rejecting wrong
owner/ACL, symlink/junction/reparse components, network/removable filesystems,
and unsupported platforms before managed admission. It retains the root handle;
there is no string-path or configurable-root fallback. Migration from any prior
workspace v2 prototype is explicit read-only import, never automatic relocation.

Workspace registration uses a signed, non-secret
`.qwen/omni/workspace-binding-v1.json` marker plus the securely opened root
directory's platform file identity. The bounded marker is at most `4_096` bytes
and contains only schema version, broker-allocated monotonic binding generation,
random nonce, root-identity HMAC, pending transaction ID, and broker MAC. It is
opened relative to the retained root handle with no-follow/reparse protection
and must be one owner-only regular file. Fatal UTF-8, unknown/duplicate fields,
bad checksum/MAC, wrong owner/ACL, oversize, or a pre/post-open identity change
puts registration into recovery-required state before project admission.

Workspace lifecycle uses two permanent broker-owned striped lock pools, never
workspace-owned or per-project lock files. At broker bootstrap, one journaled
transaction creates and fsyncs `4_096` owner-only regular files under
`path-locks/` and `4_096` under `root-locks/`, records the fixed pool
version/count and Merkle digest in the broker manifest, then commits broker
identity/catalog. Each bounded file contains its index and a domain-separated
broker MAC; every open validates content, owner/ACL, regular-file type, and
pre/post-lock file identity against the retained fd. The manifest does not add
8,192 mutable catalog rows.
Any missing/replaced/wrong-owner/link/reparse stripe after commit fails managed
mode. The fixed 8,192 files and directory charges count once against broker
control/entry limits; stripes are never unlinked, so lifecycle churn cannot
create lock debris or an unlink/recreate split.

The path stripe is selected by the first 12 bits of
`HMAC(brokerKey, "path-slot-v1\0" + nativeWorkspaceSlotV1)` and serializes
deletion, registration, rebind, and replacement for that filesystem namespace
slot. `nativeWorkspaceSlotV1` is a frozen lexical ABI independent of both
logical-locator canonicalization and parent inode identity: stable volume ID
plus the platform's absolute, volume-native comparison key for every path
component. Windows expands 8.3 names, normalizes separators, and uses ordinal
case-insensitive long-name keys; macOS queries the volume's case-sensitivity and
native Unicode comparison behavior; supported case-sensitive POSIX volumes
preserve exact component bytes. It never follows a symlink/junction to derive
the lexical key. Consequently, deleting and recreating any parent inode at the
same native namespace slot does not change the path stripe. Different lexical
aliases may use different path stripes, but after secure open the same current
workspace is serialized by its physical root stripe; byte deletion never
depends on alias serialization. A platform/filesystem that cannot provide the
required stable volume ID and native comparison key is unavailable for managed
workspace lifecycle. The ABI/version never changes in place; a future algorithm
requires a new broker namespace or an explicit global old-binary drain protocol,
not locator lookup-row migration. The root stripe is selected independently from
`HMAC(brokerKey, "root-instance\0" + canonicalPhysicalRootIdentity)` and protects
marker, physical identity, and project CAS after secure open. Hash collision
only serializes unrelated lifecycle operations; it never merges their catalog
keys or identities. The lexical stripe prevents the same native namespace slot
from registering a new inode while an old Qwen delete saga owns that slot, even
when its parent directory was replaced.
Registration persists the full lexical key; delete/recovery always reacquire
that stored key rather than recomputing it from a renamed or recreated parent.

The lock order is distinct path stripes in numeric order, distinct root stripes
in numeric order, then broker; no broker-held operation waits for a stripe.
Same-filesystem rename/rebind holds old/new path stripes and the root stripe.
Project object transactions continue to use broker then project because they
never acquire lifecycle stripes. Each catalog row records full path-slot-v1 HMAC
and physical-root HMAC in addition to stripe indices; a
collision or workspace recreation cannot silently fork/alias authority.

First registration is a split-lock three-step saga. It first holds the path
stripe, securely opens the physical root, then takes its root stripe. Under the
broker lock it atomically writes a pending row keyed by the full root-identity
HMAC with transaction ID, generation, expected marker digest, both full lock
keys/stripe indices, and a bounded owner lease, then releases the global lock.
The owner heartbeats that lease in short broker transactions while alive. Under
both lifecycle stripes it exclusively publishes/fsyncs the marker temp and
workspace parent, retains them, then briefly reacquires
the broker lock and uses transaction/generation/digest compare-and-swap to mark
the row active before releasing either lock. Thus a slow/FUSE/network workspace
fsync cannot hold the per-user broker lock or block unrelated project
reservation/GC.

Recovery or cleanup first acquires the same path and root stripes,
then the broker lock; registration never waits for either while holding broker.
Cleanup may compact a pending row only when its lease expired, the
exact process-owner identity is dead, and the locked root contains no matching
marker. A matching late marker instead completes the pending CAS; an alive owner
wins even after a delayed heartbeat or arbitrarily slow fsync. A crash before
publish rolls back, while a crash after marker rename but before CAS completes
forward. No recovery path can compact a live saga and then accept its delayed
marker.

The checksummed broker catalog is the authoritative terminal-state proof. It
never removes a nonterminal pending, active, delete-pending, unregistered, or
retiring row; a missing/corrupt catalog fails managed mode rather than treating
row absence as purge. Only the terminal-purge transaction below can compact the
last row after physical fsync. Consequently, in a valid catalog, a signed marker
with no live/pending row is proven stale and never re-creates its old project.
The registration saga may quarantine/replace it, allocate a strictly higher
generation and new project ID, and register a fresh empty project; old refs
remain unavailable. A stale marker is replaced only while holding its path and
root stripes, so no separate lifetime marker tombstone or unbounded
retired-generation set is needed. The catalog stores only HMACs of the marker
nonce, immutable native slot-v1, and physical identity projection, never
plaintext paths.

`canonicalPhysicalRootIdentity` is available before marker publication: platform
tag, volume/device identity, root file ID/inode, and stable creation identity.
The versioned binding projection adds the marker nonce to that physical
identity. Linux requires `statx` birth time,
macOS uses file ID plus `st_birthtimespec`, and Windows uses volume serial,
`FILE_ID_INFO`, and creation time; a filesystem that cannot supply this stable
identity is unavailable for managed storage. A second root-only HMAC index lets the broker detect that an
otherwise identical root lost or replaced its marker; it fails recovery-required
rather than silently forking an active project. Recovery is an explicit
operator reissue/rebind transaction. Same-filesystem rename preserves the
binding; copy, a genuinely different root identity, or cross-device move/reclone
creates a fresh generation/project and replaces any mismatched copied marker
through the saga. A path/worktree delete-recreate never inherits a row. Runtime
marker replacement aborts managed mode on the next side-effect checkpoint. A
user-confirmed broker command may rebind an inactive project through one
journaled old/new transaction; it is not a model tool or ACP method.
Logical locator canonicalizer upgrades retain old lookup rows until an explicit
atomic migration completes, but never affect `nativeWorkspaceSlotV1` or its
stripe.

Project rows are `registration-pending | active | delete-pending | unregistered |
retiring` and carry
binding generation, last-open time, checked `stateChangedAt`, optional checked
`unregisteredAt`/`retireAfter`, and physical charges. A rebind/reactivation before
retirement clears the unregistered deadlines in the same broker transaction;
retiring cannot reactivate. Clock rollback only delays eligibility, while a
forward jump cannot retire until two broker observations separated by a
code-owned 24-hour monotonic owner lease both find wall time beyond the persisted
deadline. Worktree removal first journals `delete-pending` while keeping the
binding non-retirable. A managed-v2 route is admitted only when its transcript,
writer fence, sidecars, and file-history targets are descendants of the
code-owned broker/project application-data roots; its schema has no mandatory
workspace/runtime-base locator. This invariant is checked for every retained
route, including `deleted`/terminal-cleanup rows, before removal. Consequently a
worktree can never contain a mandatory managed conversation target, even when a
legacy runtime base was relative to that worktree. `organizationRoot` is an
optional best-effort cleanup hint and never authorizes or blocks byte deletion.
An invalid/corrupt route fails managed lifecycle rather than weakening this
placement rule. Worktree removal then releases the broker lock and performs Git/filesystem
deletion while retaining the selected path/root stripes for the entire
destructive phase. The native helper retains the registered parent handle and exact child
identity, recursively removes only through handle-relative no-follow operations,
and rechecks that identity before every descent/unlink; parent replacement or
entry mismatch stops without touching the new namespace occupant. It never
passes a mutable string path to `fs.rm` or `git worktree remove`. Git admin
cleanup is a separate, identity-checked metadata/prune phase after fd-bound byte
removal and cannot delete the working tree. A failed phase never restores
`active` from its exit status alone,
because recursive removal and prune are not transactional. Under the retained
root/parent handles it revalidates the exact root identity, marker, directory,
and Git registration: only an intact matching root/marker that remains
registered rolls back to `active`; a fully absent root whose Git registration
can be reconciled and parent/registry fsynced commits `unregistered`; any
partial or contradictory evidence remains journaled `delete-pending` in
recovery-required state and admits no new managed side effect. Success plus
parent/Git-registry fsync commits `unregistered` and its timestamps. Crash
recovery uses the same evidence and never guesses from path text. Explicit
destructive project delete uses the same saga. Lease and durable-root counts are
not duplicated in the broker: while holding broker-then-project locks, retention
opens and validates project authority plus lease files and treats those as the
only byte-root truth. An unregistered project with neither live lease, durable
root, nor nonterminal session route is swept after 30 days. A registered project
root has no TTL and is released only by its branch/conversation tombstone. For an
unregistered project, the broker's explicit 365-day retirement first atomically
enters `retiring/no-new-lease` and rejects new bind/reservation. Before project
bytes or authority can be removed, retirement enumerates the bounded broker
routes whose `projectStorageId` and binding generation name that project and
drives each nonterminal conversation through the ordinary conversation-delete
saga below. The project stays readable for maintenance and its route/fence/
intent rows stay charged until every such route is terminal and compactable. A
route appearing after the retirement CAS is rejected; route creation and
retirement compare the same broker project epoch. Retirement therefore cannot
strand an active route or release the 256-route slot by silently downgrading it
to legacy. It never revokes a valid lease, descriptor pin, writer-fence holder,
or transaction owner: it waits for normal release, or for expiry plus exact
dead-owner proof. Only after all route deletions and ephemeral roots drain does
one project transaction mark remaining conversation refs unavailable and remove
durable roots before bytes are deleted. A suspended live owner may delay
automatic purge indefinitely. Forced deletion, if ever added, is a separate
explicit dangerous operator protocol with
cross-process cancellation/acknowledgement and is outside this slice.

Terminal purge is exact-once. Its precondition rechecks under the broker lock
that no nonterminal session route, conversation-delete intent, writer-fence
holder, lease, or durable root still names the project. While holding the
selected path stripe, root
stripe, then broker lock, it commits retirement/root-unavailable state, unlinks
project files, fsyncs the application-data parent, advances the binding-
generation counter, removes the live project/binding row, and releases project
charges in one final catalog transaction. That transaction is the durable purge
proof; a surviving marker cannot replay the project. The permanent stripe files
have no project state to clean and remain available for later generations, so
there is no lock-unlink crash window or terminal cleanup intent. Thus 257 or
more create/delete cycles do not turn the 256 live-row hard limit into a
lifetime limit, and physical lock usage remains the fixed bootstrap charge. An
operator-only list/rebind/delete command exposes opaque project handles and
aggregate sizes, never paths or media.

The broker enforces per-user aggregate limits in addition to project limits:
`50_000_000_000` physical object/transient/quarantine/conversation bytes,
`2_000_000_000` control bytes, `500_000` files/directories, and `256`
live/pending project rows. Quarantine remains subject to its smaller per-project
cap but never sits outside this per-user physical pool. Normal
admission may consume at most `48_000_000_000` physical bytes,
`1_744_000_000` control bytes, `480_000` entries, and `240` rows. The remaining
`2_000_000_000` physical bytes, `256_000_000` control bytes, `20_000` entries,
and `16` rows are maintenance-only and cover the maximum broker old+temp rewrite,
one project-authority old+temp/tombstone transaction, journal, settlement, and
purge. Every broker write canonicalizes its next state and reserves the maximum
of logical/allocated-block old-plus-temp coexistence before creation. Normal
bootstrap/promotion cannot consume maintenance reserve; settlement, root-
unavailable retirement, unregister, reconciliation, and GC may.

Project bootstrap, reservation, promotion, control rewrite, and GC atomically
reserve/update both broker and project ledgers under broker-then-project lock
order. Reconciliation charges orphan project directories before new admission.
A full aggregate pool never deletes a registered/live project merely to make
space; it rejects new admission with a constant operator-remediable diagnostic.
The explicit inactive retention/retirement protocol is the only automatic
cross-project reclamation.

Cross-file admission is journaled rather than assumed atomic. Under broker-then-
project locks, the broker first commits a durable aggregate reservation ID. The
project transaction references and consumes that ID; only after its directory
fsync does the broker convert the reservation to settled project usage. Crash
recovery classifies each broker reservation from the referenced project
transaction/physical files as pending, settled, or releasable before granting
new capacity. Project GC uses the reverse order: project tomb/usage change first,
physical unlink+fsync, then broker release. A crash may retain a conservative
charge but can never undercount or double-release it.

Project storage ID, key ID, and locator HMAC key are random, versioned, and
written together as one atomic `0600` `project-identity.json`; they are never
exported or shown to the model. A fixed bootstrap lock lives outside committed
v2 state. Directory/lock/temp files and an `initializing` marker are bootstrap
debris, not evidence of an initialized project. Under that lock, startup may
delete debris and restart identity creation only when there is no committed
identity, memory document, object, sidecar, or lease. Once any committed v2
state exists, a missing, replaced, or mismatched identity file/key fails managed
mode with a recovery diagnostic and is never regenerated silently. A
logical locator determines File identity; SHA-256 determines the FileVersion and
cross-File byte/policy reuse:

Identity and the initial empty authority use one recoverable bootstrap protocol.
Under the bootstrap lock, the service creates and fsyncs an identity temp and a
canonical empty-memory temp carrying the same random bootstrap nonce, then
atomically publishes `bootstrap-v1.json { nonce, identityDigest, memoryDigest,
phase: 'prepared' }` and fsyncs the directory before either final rename. It may
then rename/fsync identity and Memory in either documented order, advancing the
journal phase after each step, and removes/fsyncs the journal only after both
final files match their digest and nonce. Recovery may complete only that exact
prepared journal from its verified temps/final files. An identity without
`memory-v2.json` and without a valid live bootstrap journal is an established
project corruption, never evidence for creating a new empty graph. Debris before
the prepared journal is safe to delete only while neither final file exists.

The same native module establishes a `SecureFsRoot` for internal state before
bootstrap. Starting from the code-owned application-data handle, it creates/
opens each literal broker/project component relative to its parent while
rejecting symlink, junction, reparse, and non-directory components, then retains
the stable project directory handle. Bootstrap lock, identity, Memory, objects, staging, leases,
sidecars, journal, `.gc`, temp creation, rename, unlink, and directory fsync use
only validated relative components and handle-relative operations. They never
reconstruct an absolute child path. A pre-existing or runtime-swapped component
fails managed mode before a write/delete; there is no string-path fallback.
An independent retained workspace `.qwen/omni` parent handle is the only authority for v1
import. `memory.json`, legacy object candidates, and legacy upload/degradation
cache files are opened read-only by fixed relative name with no-follow rules;
the importer never follows a v1 `fileRef` or arbitrary artifact path. Local v1
facts stay unbacked until explicit re-reference. Legacy cache rows may be
validated and copied into a generation-bound v2 cache, but are never rewritten
or consulted directly afterward. Every new cache file is beneath the v2
`caches` handle and remains non-authoritative without a matching catalog
generation. Private paths exposed to a child Policy Tool are copies in a
separately secured lease temp root, not direct v2 storage paths.

`InternalStorageBoundary` is a shared deny service used by `read_file`, write,
glob/search, ACP local resources, model-visible UI paths, and every other model-
driven filesystem resolver. It denies the broker root, candidate-spool root,
and legacy workspace `.qwen/omni` state before path resolution and again on the
opened file identity. Trusted harness UI uses broker APIs rather than a raw path
resolver. Managed Policy
children see only their lease copy. Model-driven shell processes run in a
sandbox view that does not mount any of those private roots; if that isolation is
unavailable, the shell tool is unavailable for a managed session rather than
running with the harness's same-user view. Command-string filtering, random
names, and `0600` permissions are not treated as isolation. Operator recovery
uses an external terminal, not a model tool, and no rejected private bytes/path
are returned to the model.

Command and function hooks are trusted operator code in this threat model, not a
same-UID isolation boundary. They may access anything the user process can.
User-configured local stdio MCP servers are in that same operator TCB. They run
as the current OS user and may independently inspect application-data, legacy,
or candidate-spool roots regardless of which MCP method the model invokes;
`InternalStorageBoundary` does not sandbox another process. Enabling such a
server is therefore an explicit operator trust decision, and this design makes
no confidentiality or same-UID isolation claim against it. The harness never
passes internal paths/refs/bytes to MCP protocol payloads, but that is not a
filesystem boundary. Remote MCP servers receive no local filesystem authority.
A future sandboxed-stdio profile may move a specific server outside this TCB
only if its process view excludes broker, candidate, v1, credential, and lease
roots; command filtering or environment scrubbing alone is insufficient.
Managed hook payloads still replace internal refs, handles, paths, hashes, and
media bytes with bounded sanitized forms, but the design does not claim to stop
a configured hook from independently enumerating application data. Users who do
not trust a hook must disable it; sandboxing arbitrary hooks is outside this
slice.

`memory-v2.json` is a fail-closed authority document. Its envelope carries a
versioned checksum over the canonical payload bytes excluding the checksum
field; startup validates the complete schema,
safe integer bounds, unique IDs, graph/catalog/binding/root references, storage
epoch, and identity linkage before exposing any managed service. An unreadable,
truncated, malformed, checksum-invalid, or referentially inconsistent document
puts that project into a read-only recovery-required state: no empty rebuild,
promotion, root mutation, import, cache publication, or GC is allowed. Only an
explicit operator restore of a separately preserved valid snapshot can resume
managed mode. The pre-managed compatibility path may still run, but it cannot
touch v2. Recovery diagnostics contain only constant reason IDs.
If a v2 namespace already exists, this read-only health validation is also a
candidate-gate prerequisite and happens before candidate-spool reservation; it
does not initialize a new project. A new project is bootstrapped only by the
explicit managed-conversation creation transaction before its first append, not
by a per-media candidate/exact gate. A legacy conversation never bootstraps v2
in place even after an exact media proof.

All project JSON/control inputs are bounded before allocation. Handle-relative
`fstat` rejects `memory-v2.json` and v1 `memory.json` above `64_000_000` bytes,
one sidecar above `4_000_000`, one cache file above `8_000_000`, one lease above
`65_536`, or the liveness journal above `16_000_000`. A fatal UTF-8, bounded-depth
decoder then enforces depth `32`, at most `100_000` graph/catalog/root records,
`400_000` references, `65_536` bytes per generic persisted string, and tighter
field caps: display name `1_024`, MIME/role/ID `256`, disclosure `4_096` UTF-8
bytes. Canonical write validation applies the same limits before allocation and
again before rename. Oversized/overdeep v2 authority enters recovery-required;
an oversized v1/cache snapshot is skipped as one import unit without blocking
ordinary v2 transactions; an oversized sidecar is unavailable but its existing
root is retained until explicit tombstone/recovery.

Control metadata has a separate code-owned `512_000_000`-byte physical cap,
independent of `omni.storage.maxTotalBytes`. It counts authority, atomic temp,
identity/bootstrap, sidecars, caches, leases, journal, and directory entries by
secure-root reconciliation, charges each file by the maximum of logical size,
allocated blocks, and `4_096` bytes, and permits at most `100_000` control files.
Normal semantic admission may consume at most
`448_000_000`; the remaining `64_000_000` is reserved for one authority rewrite,
root tombstone, lease cleanup, cache/journal compaction, and GC progress. Before
each transaction the writer canonicalizes the proposed next state under its
schema cap, reserves the exact old-plus-temp coexistence bytes, and rejects new
semantic collection before CAS/policy effects if the settled/control cap would
be exceeded. Existing state remains readable and maintenance may use the reserve.
Caches are LRU bounded and never roots; the journal compacts to the latest row
per object; expired dead-owner leases are removed; conversation sidecars live
until their branch tombstone. No required S5 fact is silently pruned to regain
metadata capacity.

Managed transcript and file-history contents are not control metadata. Their
logical/allocated-block bytes share the project's `omni.storage.maxTotalBytes`
and the broker's 50-GB physical pool; their file/directory entries also consume
the control-entry caps above. A code-owned `64_000_000`-byte per-project
conversation maintenance reserve sits outside normal `maxTotalBytes` admission
but inside the broker's 2-GB physical maintenance reserve; only deletion
tombstones, exact rollback/truncate, and crash settlement may use it, never a
normal turn, media object, fork, or backup. A durable `ConversationByteReservation` in the
project authority and its broker aggregate reservation bind transaction ID,
owner lease, conversation generation, target kind
`transcript-append | fork-transcript | file-history`, exact existing file/
parent identity or authenticated absent-file verdict, old length, maximum new
logical/allocated bytes, entry delta, and config epoch. It is committed before
the first output byte and settles only
after file and required parent fsync. Physical reconciliation charges an unknown
or orphan occupant before new admission rather than guessing it is free.

One canonical chat JSONL record is capped at `16_000_000` UTF-8 bytes and carries
its transaction/record UUID. Before sidecar/group adoption or chat append, the
writer encodes the whole record, reserves its exact line bytes plus worst-case
allocation-block growth, and remembers the retained file identity and old
length. Append+fsync then settles the reservation. On restart, an exact complete
UUID/digest at the old offset settles idempotently; absent or partial bytes are
truncated to the old length and fsynced before release; identity or content
mismatch is recovery-required. Admission rejection occurs before any write and
returns a constant capacity error while keeping the session readable. An
unexpected write/fsync/capacity-drift failure uses maintenance control reserve
to set `recordingState:'recovery-required'`, blocks further append/resume, and is
cleared only after that exact truncate-or-settle recovery.

Fork transcript and file-history batches use counting sinks in deterministic
private temps. Under one batch reservation they fsync every file and directory,
publish by handle-relative no-replace rename, and settle only after destination
parent fsync; failure removes only matching temps and leaves the target hidden.
Archive/unarchive is a same-filesystem rename under the existing settled charge,
never a copy fallback. Delete/retirement releases content bytes and entry charge
only after exact unlink/rmdir plus parent fsync. Boundary tests cover cap minus
one/equal/plus one, concurrent append reservations, a large tracked file,
fork duplication, partial JSONL write, lost acknowledgement, physical ENOSPC,
and every settlement crash boundary.

```text
local:v2:<user|tool>:HMAC(projectKey, canonical lexical path)
url:v2:user:HMAC(projectKey, canonical HTTPS URL without fragment)
inline:v2:<surface>:<conversationId>:<messageOrToolCallId>:<nestedPartPath>
policy:v2:<rootFileId>:<executionId>:<executionOutputId>
```

The v2 canonicalizers are fixed:

- local: resolve `.`/`..` against the runtime workspace without following the
  final symlink, normalize separators to `/`, uppercase a Windows drive letter,
  preserve the exact Unicode code-unit sequence supplied to Node, and do not
  case-fold or normalize Unicode. A UI-only display form may be NFC, but the HMAC
  input is the exact platform-distinguishable lexical string plus platform tag.
  This deliberately preserves separate POSIX NFC/NFD entries and lexical case
  variants as independent provenance.
- URL: parse with the WHATWG `URL` implementation; require HTTPS; reject
  userinfo; lowercase scheme/host, remove the default port, use the serialized
  dot-segment-normalized pathname/percent encoding, preserve query order and
  duplicate keys exactly as serialized, and remove the fragment.

URL query values participate inside the HMAC but never persist in plaintext.
Retry/replay of the same stable message/tool-call/part path reuses one occurrence
key; a new invocation receives a new key. A built-in `read_file` occurrence uses
the tool-local locator once and is not recreated when the scheduler later sees
its inline representation. Separate origins/locators remain separate Files even
when their SHA-256 is equal.

The v2 File schema removes v1 raw `fileRef`. Its responsibilities split:
`logicalLocatorKey` on the S5 File owns identity; bindings in the storage
catalog resolve bytes for recognition, policy, tools, and full text/file policy
artifacts. The model sees neither. The runtime never needs a persisted raw path
to resolve a policy tool.

The v2 policy-entry schema likewise removes `artifactRef.workspacePath` and
does not treat an embedded `managedId` as authority. It keeps semantic MIME/
size/role/coverage plus an entry binding into the catalog. Migration validates
and copies a v1 managed artifact before creating that binding, then scrubs the
old path; an unavailable artifact becomes an unbacked binding.

Managed backing is explicit:

```ts
interface ManagedObjectRecord {
  managedObjectId: string;
  sha256: string;
  sizeBytes: number;
  generation: number;
  promotedAt: string;
  state:
    | { kind: 'managed' }
    | { kind: 'deleting'; deleteNonce: string }
    | { kind: 'missing' };
}

type ManagedObjectBinding =
  | {
      owner: 'file-version';
      fileVersionId: MediaFileVersionId;
      managedObjectId: string;
    }
  | {
      owner: 'policy-entry';
      entryId: MediaMemoryEntryId;
      managedObjectId: string;
    }
  | {
      owner: 'unbacked';
      ownerId: MediaFileVersionId | MediaMemoryEntryId;
      reason: 'legacy' | 'collected' | 'missing';
    };
```

The object table is keyed by the project-local content address
`managedObjectId = HMAC(projectKey, "object:v1\0" + sha256)`; bindings are
indexed separately by FileVersion and policy entry. MIME and other semantic
metadata stay on those owners rather than the deduplicated byte object. A
derived-media entry may bind the same object as its derived FileVersion. A
transcript/file entry without a FileVersion still has a first-class binding, so
its complete object can be replayed, reused, rooted, marked missing, or
rehydrated. The liveness journal is also keyed by object ID. Persisted groups
root only object bindings reached by their media refs or text/file `entryId`;
group-level source/root metadata and unrelated S5 entries do not pin bytes.

FileVersion remains byte identity; recognition is a versioned immutable
assertion rather than one mutable field on that identity:

```ts
interface RecognitionAssertion {
  assertionId: string;
  fileVersionId: MediaFileVersionId;
  detectorVersion: string;
  ingestionConfigHash: string;
  probeIdentity:
    | {
        kind: 'stable';
        backendId: string;
        backendVersion: string;
        digest: string;
      }
    | { kind: 'run'; backendId: string; recognitionRunId: string };
  recognized: RecognizedMedia;
}
```

The assertion ID is derived from the FileVersion, detector/config identity, and
the discriminated probe identity. A bundled/code-owned probe may use a stable
version plus executable digest. The current PATH-resolved `ffprobe` cannot make
that claim: every recognition invocation receives a random
`recognitionRunId`, and its output is never compared for equality with another
run. This avoids treating a PATH replacement or two binaries with the same
version string as persistent corruption. `FileRecognized` atomically
creates/reuses the FileVersion, object binding, and this assertion; it remains
one semantic collection trigger, not a third collection. Only an identical
stable assertion key must have an exact immutable canonical projection. A
detector/config/backend upgrade or PATH-based run creates a new assertion for
the same bytes. V1's single or partial recognition imports as a generation-zero
legacy assertion and never blocks a fresh complete v2 assertion.

Every persistent binding, media group item, policy source, and durable reference
carries `recognitionAssertionId`; a runtime envelope carries either that ID or a
request-local verdict ID plus its historical assertion ID. Registry identity is
`(fileVersionId, effectiveRecognitionId)`, not FileVersion alone. The recorded
assertion is immutable provenance for audit/replay correlation, but it never
authorizes a new physical egress. Resume, provider switch, active/passive
recall that materializes bytes, and history materialization first obtain a fresh
request-local recognition verdict for the current frozen detector/config/probe
run over the pinned immutable object and bind the newly issued session handle to
that verdict. This read-only path does not commit a new S5 assertion or mutate
Memory; only an explicit FileRecognized collection trigger may persist the same
canonical shape. The guard and manifest consume only the current runtime
verdict. If fresh recognition cannot complete or now rejects the object, egress
fails closed even if the historical assertion would have passed. Pure metadata
recall may show the recorded assertion's bounded provenance without treating it
as a current safety verdict. A policy execution is allowed only after its normal
source collection trigger and carries that trigger's persisted assertion.

The v2 File current pointer is an atomic pair, never a version-only field:

```ts
interface CurrentRecognizedVersion {
  fileVersionId: MediaFileVersionId;
  recognitionAssertionId: string;
}
```

`FileRecognized` validates assertion ownership and updates this pair in its one
transaction. Default/current-version recall reads exactly that pair. Historical
recall either names a persisted assertion through its binding or returns a
bounded list of assertion summaries; it never silently selects “latest”. Every
metadata entry, gap, advisor result, side query, and candidate summary carries
the assertion ID that supplied its evidence. A request-local runtime verdict is
not eligible to become the File current pointer.

`generation` is allocated/incremented in the same v2 transaction whenever an
object first becomes managed, is invalidated/made missing, or is rehydrated.
Upload/delivery/degradation cache entries carry project storage ID, object ID,
and exact generation. A cache hit takes the project lock and succeeds only when
the current record is `managed` with that generation; a stale row is a miss even
if an independent legacy JSON cache file survived or was rewritten by another
process. Corruption/GC therefore advance authoritative generation atomically;
physical cache-file cleanup is asynchronous and cannot resurrect authority.

V2 physical objects have one extensionless locator independent of MIME:
`objects/<first-two-base32-chars>/<managedObjectId>` relative to the brokered
project root, where the
HMAC output uses lowercase unpadded base32 and is validated before path
construction. No owner-provided suffix participates. A private pinned snapshot
may add a code-owned extension derived from the binding's semantic MIME solely
for a Policy Tool; it is not CAS identity. During import, all verified v1
extension-bearing paths with the same SHA-256 collapse into this one v2 object;
conflicting bytes are quarantined/unbacked, never selected by extension. Object
deduplication, capacity, pin, GC, and backfill always use this single locator.

The v1-to-v2 importer reads but never moves, rewrites, or deletes v1. It runs
under the v2 writer lock at startup and as bounded maintenance around each v2
transaction, but import capacity failure never fails or steals capacity from the
requested v2 mutation. The writer first canonicalizes and reserves the current
operation's settled authority/control delta. Only then may the importer consume
remaining normal-admission capacity, with at most one closed subgraph per
foreground transaction; root release/GC maintenance remains able to use the
maintenance reserve. After the requested transaction commits, unused reservation
is released and later transactions may import more. A stable v1 snapshot
is proven by file identity/size/mtime checks around the read. The v2
document stores a canonical digest watermark for every imported v1 record plus
the digest of its last projected v2 form; absence from a later v1 snapshot is
never interpreted as deletion because older stores may prune malformed rows.

Import is a bounded sequence of referentially closed subgraphs, not one
all-or-nothing projection of the whole v1 snapshot. Under the lock, the importer
canonicalizes and size-counts one complete candidate subgraph plus its alias,
assertion, unbacked binding, and watermark rows before mutation. If that unit
would exceed the v2 authority or control-metadata admission cap, it records at
most one process-lifetime constant diagnostic, leaves the unit's watermark
unchanged, and proceeds with the original v2 transaction. A later capacity
release retries it. No extra persisted file/row is needed. No partial subgraph is
visible, and an old writer continually appending an unimportable unit cannot
block capture, root release, or GC for independent v2 facts.

Immutable unseen versions, executions, and entries are imported only after all
references validate. A changed v1 `File.currentVersionId` is applied only after
its target version has been imported and the current v2 File still equals the
previous imported projection. If v1 and v2 advanced the pointer independently,
both versions remain facts, the pointer stays unchanged, and an explicit
sanitized conflict record requires fresh user re-reference; the conflict is
never described as a successful merge. This three-way rule also handles a v1
file reverting to an older version.

The projected v1 File pointer always pairs the target version with that
version's generation-zero legacy assertion. Pointer three-way merge compares
the complete pair; it never advances a version without an owned assertion.

The locator index, not record ID alone, detects the same logical occurrence. If
a v2 File already owns the imported HMAC locator under another ID, the importer
chooses that canonical File and atomically remaps the complete imported v1
subgraph—version IDs and every file/version/root/parent/execution/entry
reference—through a persisted alias table. Old IDs are preserved only when no
locator collision exists. An inconsistent or incomplete remap is quarantined as
a whole; it can never create two v2 Files for one locator.

Thus old and new binaries may coexist without destructive mixed-schema writes:
old processes continue to see only v1; new processes import non-conflicting
atomic v1 changes and explicitly expose concurrent conflicts. The importer
claim is limited to Memory snapshots. Managed conversations are created in the
broker-private namespace from their first append and are never upgraded from a
d9-visible transcript. Mixed-binary append to one physical conversation is not
supported; a same-ID d9 runtime file remains an unrelated legacy ghost. The importer
cannot repair lost updates between two old processes because v1 itself has no
cross-process lock. V2 facts are not backported to v1, so cross-version feature
consistency is not promised until old processes exit, but neither store can
corrupt the other.

Migration computes the HMAC locator from each v1 raw local path before writing
the v2 record, then scrubs the path; v2 disk fixtures must contain no plaintext
path or URL query. It preserves non-conflicting old IDs and graph edges and
first commits every imported byte owner as `unbacked`/pending; metadata graph
import never copies bytes. Each whole-subgraph remap and watermark advance only
with that unit's complete metadata transaction. An old local version is backfilled
only after explicit re-reference, fresh capture, and hash verification. An old
managed derivative or full text/file artifact may be backfilled independently:
open its stable v1 fd under the retained parent handle, reserve transient-copy
plus unique-object capacity under the project lock, stream/hash/promote, and
commit one binding. ENOSPC, abort, or copy/commit crash releases/reclassifies
the temporary reservation and leaves the owner pending/unbacked; it does not
roll back metadata import or block ordinary v2 transactions. Dedup consumes no
second object charge and capacity release permits a later retry. Unbacked facts
remain valid metadata/reuse records but cannot issue a durable conversation
reference or complete text replay until backing is restored.

V1 cannot reconstruct provenance that it already collapsed, such as two old
tool/URL occurrences whose `fileRef` was the same CAS path. Migration assigns
that record a versioned `legacy` locator and does not fabricate separate Files;
all occurrences captured after v2 use the new locator schemes and preserve
independent provenance. This limitation is reported once and covered by a
migration fixture.

S5 v2 also separates a reusable computation key from an execution attempt. V1
executions import as generation zero. A v2 execution family keeps the existing
source-version/config/tool-version identity, while each completed attempt has a
monotonic generation allocated under the project lock. Reuse selects the latest
compatible attempt whose complete ordered output bindings are backed.

```ts
interface V2PolicyExecutionIdentity {
  computationKey: string; // source SHA + normalized config/tool version
  familyId: string; // source version + normalized config/tool version
  generation: number;
  executionId: string; // legacy id at generation 0; v2 hash for generation > 0
  reusedExecutionId?: string; // byte-producing execution for cross-File reuse
  orderedOutputs: readonly ExecutionOutputRef[];
}

type PolicyUseRecord = PendingPolicyUseRecord | CompletedPolicyUseRecord;

interface PendingPolicyUseRecord {
  state: 'pending';
  useId: string;
  invocationId: string;
  sourceFileVersionId: MediaFileVersionId;
  sourceRecognitionAssertionId: string;
  computationKey: string;
  owner: Extract<PolicyUseOwner, { kind: 'in-flight' }>;
}

interface CompletedPolicyUseRecord {
  state: 'completed';
  useId: string;
  invocationId: string;
  sourceFileVersionId: MediaFileVersionId;
  sourceRecognitionAssertionId: string;
  executionId: string;
  generation: number;
  outcome: 'executed' | 'reused';
  orderedOutputs: readonly PolicyUseOutputRef[];
  owners: Readonly<Record<PolicyUseOwnerId, PolicyUseOwner>>;
}

type PolicyUseOwnerId = string;

type ConversationGeneration = number;
type SidecarId = string;

type PolicyUseOwner =
  | {
      kind: 'in-flight';
      leaseId: string;
      ownerId: string;
    }
  | {
      kind: 'adopting';
      transactionId: string;
      leaseId: string;
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      expectedSidecarDigest: string;
      expectedChatRecordId: string;
    }
  | {
      kind: 'conversation-group';
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
    }
  | {
      kind: 'conversation-unavailable';
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      correctionRecordId: string;
      reasonId: 'missing-sidecar' | 'invalid-sidecar';
    };

type DeliveryGroupAdoptionRecord =
  | {
      state: 'adopting';
      origin:
        | { kind: 'initial' }
        | {
            kind: 'clone';
            sourceConversationId: string;
            sourceConversationGeneration: ConversationGeneration;
            sourceBranchNodeId: string;
            sourceGroupId: string;
          };
      transactionId: string;
      leaseId: string;
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      sidecarId: SidecarId;
      sidecarDigest: string;
      sidecarFileIdentity: string;
      expectedChatRecordId: string;
      managedObjectIds: readonly ManagedObjectId[];
      policyUseIds: readonly string[];
    }
  | {
      state: 'conversation-group';
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      sidecarId: SidecarId;
      sidecarDigest: string;
      sidecarFileIdentity: string;
      chatRecordId: string;
      managedObjectIds: readonly ManagedObjectId[];
      policyUseIds: readonly string[];
    }
  | {
      state: 'conversation-unavailable';
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      correctionRecordId: string;
      reasonId: 'missing-sidecar' | 'invalid-sidecar';
      policyUseIds: readonly string[];
      sidecarCleanup:
        | { state: 'absent' }
        | {
            state: 'quarantine-pending';
            sidecarId: SidecarId;
            observedFileIdentity: string;
          };
    }
  | {
      state: 'deleting';
      deleteTransactionId: string;
      conversationId: string;
      conversationGeneration: ConversationGeneration;
      branchNodeId: string;
      turnId: string;
      groupId: string;
      sidecarId: SidecarId;
      expectedSidecarDigest: string;
      expectedSidecarFileIdentity: string;
      cleanupState: 'pending-unlink' | 'unlinked-parent-fsynced';
      policyUseIds: readonly string[];
    };

type ConversationLifecycleState =
  | 'fork-preparing'
  | 'active'
  | 'writer-transition-preparing'
  | 'delete-preparing'
  | 'deleting'
  | 'deleted';

type ManagedWriterFenceState =
  | { kind: 'idle' }
  | { kind: 'live'; ownerId: string }
  | { kind: 'delete-terminal'; deleteTransactionId: string };

interface WriterFenceTransitionIntent {
  transactionId: string;
  purpose: 'initialize' | 'resume' | 'handoff' | 'close' | 'delete';
  oldFence: ManagedWriterFenceState | { kind: 'absent' };
  newFence: ManagedWriterFenceState;
  routeAuthorityDigest: string;
  expectedOldRecordDigest: string;
  expectedNewRecordDigest: string;
  oldRouteState: 'fork-preparing' | 'active' | null;
  newRouteState: 'fork-preparing' | 'active' | 'delete-preparing';
  phase: 'broker-prepared' | 'physical-installed';
}

type ForkTranscriptProof =
  | {
      state: 'planned';
      expectedDigest: string;
      expectedParentIdentity: string;
      expectedLeafAbsent: true;
      privateTempLeaf: string;
    }
  | {
      state: 'temp-published';
      expectedDigest: string;
      expectedParentIdentity: string;
      privateTempLeaf: string;
      tempFileIdentity: string;
      byteLength: number;
    }
  | {
      state: 'published';
      expectedDigest: string;
      fileIdentity: string;
      byteLength: number;
    };

interface ForkPublicationIntent {
  sourceSessionIdHmac: string;
  sourceConversationGeneration: ConversationGeneration;
  targetCreationOwnerId: string;
  transcript: ForkTranscriptProof;
  expectedGroupSetDigest: string;
  fileHistoryPhase: 'pending' | 'complete';
}

interface ConversationRootBootstrapIntent {
  transactionId: string;
  reservationId: string;
  sessionIdHmac: string;
  projectStorageId: string;
  projectBindingGeneration: number;
  conversationGeneration: ConversationGeneration;
  ownerLeaseId: string;
  parentDirectoryFileIdentity: string;
  deterministicLeaf: string;
  phase:
    | { state: 'prepared'; expectedLeafAbsent: true }
    | { state: 'root-published'; directoryFileIdentity: string };
}

type SessionRouteAccessContext =
  | {
      kind: 'project-runtime';
      projectStorageId: string;
      projectBindingGeneration: number;
      bindingLeaseId: string;
    }
  | {
      kind: 'maintenance';
      brokerMaintenanceLeaseId: string;
      purpose: 'recovery' | 'retirement' | 'operator-delete';
    };

interface SessionRouteRecord {
  sessionIdHmac: string;
  projectStorageId: string;
  projectBindingGeneration: number;
  conversationGeneration: ConversationGeneration;
  state: ConversationLifecycleState;
  archiveState:
    | 'active'
    | 'archived'
    | 'moving-to-active'
    | 'moving-to-archive'
    | 'conflict';
  transcriptFiles: {
    active: null | { fileIdentity: string };
    archived: null | { fileIdentity: string };
  };
  recordingState:
    | { state: 'healthy' }
    | {
        state: 'recovery-required';
        transactionId: string;
        reasonId: 'write-failed' | 'fsync-failed' | 'capacity-drift';
      };
  transactionId: string;
  routeAuthorityDigest: string;
  conversationRootFileIdentity: string;
  writerFence: ManagedWriterFenceState | { kind: 'absent' };
  writerTransition: WriterFenceTransitionIntent | null;
  terminalFenceCleanup: null | {
    transactionId: string;
    expectedFenceDigest: string;
    expectedConversationRootFileIdentity: string;
    phase:
      | 'prepared'
      | 'fence-unlinked-parent-fsynced'
      | 'claim-unlinked-parent-fsynced'
      | 'conversation-root-removed-parent-fsynced';
  };
  forkPublication: ForkPublicationIntent | null;
  storageRouteKeyId: string;
  storageRouteNonce: string;
  storageRouteCiphertext: string;
  storageRouteAadDigest: string;
}

interface SessionStorageRoutePlaintext {
  schemaVersion: 1;
  managedConversationsRoot: SecureDirectoryLocator;
  managedConversationLeaf: string;
  activeTranscriptLeaf: string;
  archivedTranscriptLeaf: string;
  sessionWriterLeaseLeaf: string;
  fileHistoryLeaf: string;
  organizationRoot: SecureDirectoryLocator | null;
}

interface ManagedTranscriptCursorV2 {
  schemaVersion: 2;
  keyId: string;
  sessionRouteHmac: string;
  projectStorageId: string;
  projectBindingGeneration: number;
  conversationGeneration: ConversationGeneration;
  archiveState: 'active' | 'archived';
  transcriptFileIdentity: string;
  snapshotSize: number;
  byteOffset: number;
  lastRecordId: string | null;
  mac: string;
}

interface SecureDirectoryLocator {
  platform: 'linux' | 'macos' | 'windows';
  canonicalAbsolutePath: string;
  volumeId: string;
  directoryFileIdentity: string;
  ownerIdentity: string;
}

type PolicyUseOutputRef =
  | {
      kind: 'media';
      useOutputId: string;
      executionOutputId: string;
      entryId: MediaMemoryEntryId;
      fileVersionId: MediaFileVersionId;
    }
  | {
      kind: 'text' | 'file';
      useOutputId: string;
      executionOutputId: string;
      entryId: MediaMemoryEntryId;
    }
  | {
      kind: 'omission' | 'disclosure';
      useOutputId: string;
      executionOutputId: string;
    };

type ExecutionOutputRef =
  | {
      kind: 'media';
      executionOutputId: string;
      entryId: MediaMemoryEntryId;
      fileVersionId: MediaFileVersionId;
      attachedDisclosure?: PolicyAttachedDisclosureProjection;
    }
  | {
      kind: 'text' | 'file';
      executionOutputId: string;
      entryId: MediaMemoryEntryId;
      attachedDisclosure?: PolicyAttachedDisclosureProjection;
    }
  | {
      kind: 'omission' | 'disclosure';
      executionOutputId: string;
      templateId: string;
      templateVersion: number;
      canonicalTextSha256: string;
    };

interface PolicyAttachedDisclosureProjection {
  source: 'artifact-metadata';
  canonicalTextSha256: string;
}

type StorageDeterminism = 'deterministic' | 'nondeterministic';
```

`ConversationGeneration` is a branded checked positive safe integer in the
closed interval `1..Number.MAX_SAFE_INTEGER`; the broker refuses a new
managed-conversation creation when increment would exceed that bound. It is never a nominal
JavaScript `uint64`, and canonical JSON, HMAC/AAD construction, comparison, and
sorting all use the exact safe-integer decimal representation. `SidecarId` is
not a free string: it is the 52-character lowercase unpadded base32 encoding of
`HMAC(projectLocatorKey, "conversation-sidecar-v1\0" + canonical tuple)`, where
the tuple is sidecar schema version, conversation ID, conversation generation,
branch node ID, turn ID, and group ID. The shard is exactly the first two ID
characters. Parsing accepts only `^[a-z2-7]{52}$`, recomputes the tuple-to-ID
binding before any open/unlink, and treats collision or mismatch as authority
corruption. Retry derives the same path; fork necessarily derives a target-
generation path. No separator, dot component, Unicode, case-folded alias, or
caller-selected ID reaches `SecureFsRoot`.

Imported generation zero is an identity-preserving exception: `familyId` points
at the new family, but `executionId`, entry IDs, output references,
`producedByExecutionId`, and derived-version lineage retain their exact v1
values. The family record stores that legacy execution ID as generation zero.
Only a newly allocated generation greater than zero uses
`hash("execution:v2\0" + familyId + generation)`. This preserves every
non-conflicting v1 ID and edge while allowing backed-attempt selection to move
forward. A locator/subgraph collision still follows the explicit whole-graph
alias/remap rule above.

Computation identity remains assertion-independent, but every invocation that
enters managed policy processing atomically writes the discriminated pending
form with invocation/source/computation identity and exactly one live in-flight
owner—no execution, outcome, or outputs. Policy failure/dead-owner cleanup may
delete that valid pending row. Only after the immutable artifact batch is fully
validated does `OmniPolicySucceeded` atomically create/select the execution and
replace pending with the completed form containing generation, outcome, ordered
outputs, and its in-flight owner. A zero-output completed batch is distinct from
pending by `state`, and startup graph validation checks each union arm under its
own references. Reuse under assertion B may point to bytes
computed by an attempt first produced under assertion A; it writes a B-specific
`outcome:'reused'` record rather than modifying or impersonating the old
execution. Delivery groups reference `useId` plus B. Recall distinguishes the
attempt that produced bytes from the assertion used for this policy decision.
An assertion-conditioned configuration participates in the computation key as
its normalized condition inputs; reuse cannot skip a changed condition verdict.

For cross-File/content reuse, the same transaction creates B's own execution
whose `reusedExecutionId` points to byte-producing execution A. B's immutable
execution `orderedOutputs` point to B-specific entry/derived-version/ref rows
whose parent/root is B; every attempt-owned row points
`producedByExecutionId` back to execution B. Only the object binding deduplicates
A's physical bytes. This preserves the existing symmetric execution-output
graph rather than creating B rows that appear only as reverse edges from A.

Attempt output identity and completed invocation occurrence identity are deliberately
separate. `executionOutputId = HMAC(executionId, "output\0" +
validatedArtifactIndex)` is stable for the immutable attempt and owns its
entry/FileVersion/semantic projection. Every completed `PolicyUseRecord` has a distinct
`useOutputId = HMAC(useId, "output\0" + validatedArtifactIndex)` that references
one stable `executionOutputId`; the use row itself is the occurrence/provenance
edge. Attempt-owned entries are never rewritten with `producedByPolicyUseId`.
Two invocations of the same FileVersion/assertion/config may therefore reuse one
execution and its stable rows while committing two use records with distinct
use-output IDs. Cross-File B still gets B's own immutable execution rows before
its use projection is written.

The use record's discriminated, ordered refs must exactly match the referenced
execution outputs and B-specific bindings; an omission/disclosure execution
edge has no fabricated entry or FileVersion but authenticates its bounded
semantic projection. `useId` is the HMAC of source FileVersion, source
assertion, and scheduler-issued normalized invocation ID—only fields available
before execution. The completed arm then binds that stable use ID to exactly one
execution/generation and ordered output set; execution identity never changes
the pending key. Retry carries the same invocation/use IDs and must match the
already committed execution and ordered refs exactly; a new invocation gets a
new ID/use/use-output set without mutating the attempt. Commit/replay validates
source ownership, assertion, attempt, use-to-execution mapping, B-specific
parent/root, output kind/order, and group items atomically.

PolicyUse is occurrence state, not an immortal computation fact. Owners form a
canonical map, not an append-only list. The owner ID is a domain-separated HMAC
of the exact discriminant tuple: lease/owner for `in-flight`, transaction/
conversation-generation/turn/group for `adopting`, or conversation/generation/
branch/turn/group for durable ownership.
Schema validation rejects a mismatched key, duplicate semantic tuple, unknown
owner kind, or noncanonical key order. Add is idempotent add-if-absent; removal
is compare-and-delete of one exact key. Retry and fork replay therefore cannot
inflate reference count, and a tombstone never guesses how many duplicates to
remove.

Durable adoption is one delivery-group saga across three persistence domains,
not one independent saga per PolicyUse and not a fictitious cross-file
transaction. The recorder first writes/fsyncs the bounded sidecar under its
expected digest while a transaction lease pins the group's canonical unique
object-root set. Under the project lock, one transaction creates the group-level
`adopting` record with that root set and every completed `policyUseId`, converts
the lease roots to adopting roots, and CAS-replaces every listed PolicyUse's
in-flight owner with the matching adopting owner. A raw-source-only group has an
empty use list but the same adoption record; a mixed or multi-policy group is
accepted only when the sidecar, root set, group items, and every use/output edge
match atomically. It then appends/fsyncs the chat JSONL record with transaction
ID, record UUID, group ID, sidecar digest, root-set digest, use-set digest, and
conversation generation. Finally, after re-reading the authoritative record and
sidecar, one project transaction changes the whole group to
`conversation-group`, changes every listed use owner likewise, and retains the
group's roots. The chat record is commit evidence: an exact durable record and
sidecar always forward-complete the entire group; absent record plus expired/
exact-dead owner rolls back the group, all adopting use owners, roots, and
sidecar; an ambiguous live writer waits. Append success with lost
acknowledgement is idempotent, and replay encountering any adopting member first
resolves the single group transaction. GC treats both adopting and durable group
root sets as roots, so no per-item order exposes a chat ref to reclaimable bytes.

An exact durable chat record with a missing, truncated, bit-flipped, replaced,
or digest-mismatched sidecar is a committed group occurrence, not an absent
record and not an infinite adopting lease. Recovery appends/fsyncs one idempotent
code-owned correction record keyed by the group adoption transaction and
original chat UUID; it contains only group ID and bounded `missing-sidecar` or
`invalid-sidecar`. After re-reading that correction, one project transaction
changes the group and all listed PolicyUse owners to `conversation-unavailable`,
removes its object roots, releases the adoption lease/maintenance reservation,
and retains occurrence metadata plus an exact cleanup verdict. A missing sidecar
stores `absent`; a present invalid sidecar stores its deterministic ID/observed
file identity as `quarantine-pending`, remains physically charged, and is moved
to broker-counted quarantine through the existing exact-once protocol before the
cleanup arm becomes `absent`. This arm
also handles raw-only and zero-output/omission groups. Replay uses the
authenticated correction to substitute the bounded unavailable group and never
reconstructs refs or bytes. An indeterminate chat/sidecar read enters recovery-
required rather than being treated as absent or corrupt. The same correction
UUID makes acknowledgement loss idempotent.

Fork/branch ownership uses the group saga with `origin.kind:'clone'`, not the
initial in-flight-owner replacement. Under the source fence and the target
`fork-preparing` creation-owner fence in stable generation order, it validates
the source durable group/root/use set, prepares a target-generation sidecar,
creates a target adopting group with the
same object roots, and add-if-absent inserts one target adopting owner into every
existing completed PolicyUse while preserving every source owner. Finalize,
rollback, and correction change/remove only those target owners and roots. A
raw-only group follows the same clone record with an empty use set. Deleting the
source or target therefore cannot invalidate the other; copying existing history
never reruns Policy or fabricates an in-flight owner.
Rewind keeps owners for nodes that remain legal branch sources. A branch or
conversation tombstone is first appended/fsynced to the chat log with its exact
owner key and record UUID; only observed durable tombstone evidence permits the
project transaction to transition each target group into the same non-rooting
`deleting` cleanup arm and remove only that branch/conversation's PolicyUse
owners. Its deterministic sidecar cleanup completes before the row disappears;
full conversation deletion additionally uses the aggregate intent below. Crash
before removal only leaks a recoverable owner/root temporarily; it cannot delete
a use still referenced by chat.
Provider failure before adoption, abort, or a dead in-flight owner removes the
pending row or completed in-flight use/use-output occurrence while retaining the
stable execution graph.
After the last durable owner is removed, the use row is deleted. All adopting
states and sidecars retain maintenance reservation/lease roots until resolution.
PolicyUse/use-output rows count toward the authority cap; this mandatory
occurrence cleanup does not prune an S5 recognition/execution fact.

Managed conversations are a distinct creation-time mode, not an in-place
upgrade of an existing legacy transcript. A new conversation may choose managed
mode only when Omni is enabled, the workspace is trusted, and the resolved turn
configuration has at least one enabled, authorized native media profile or a
statically complete authorized preprocessing route. This is an explicit
session-factory decision made before the first chat append; it does not inspect
or await the first attachment. A text-only first turn and a false-positive first
attachment therefore still use the already selected managed lifecycle, while
the per-media candidate/exact barrier independently decides whether that turn
may create File/CAS/Memory/policy state. If no managed route is eligible,
the conversation is created through the exact legacy path and no broker/project
v2 state is created. Enabling Omni later does not migrate that transcript: the
conversation remains legacy and uses session-only media behavior; the user must
start a new managed conversation. The first slice also does not import or fork a
legacy transcript into managed mode.

A managed conversation's transcript, archive leaf, file-history leaf, sidecars,
and writer fence all live beneath owner-only broker/project application-data
roots created before the conversation becomes visible. This bounded lifecycle
state is an allowed effect of the explicit session-mode decision and is outside
the media candidate gate's zero-effect promise. They never live beneath
the runtime, workspace, or worktree tree. The exact d9 binary does not know this
root and therefore cannot enumerate, open, append, archive, or delete a managed
transcript. If an old binary is explicitly given the same public session ID, it
may create an unrelated legacy file in its own runtime; the new resolver treats
the broker route as authoritative and never reads, imports, merges, or deletes
that same-ID legacy ghost. This isolation is the compatibility boundary; the
design does not depend on d9 enabling `SessionWriterLease` or parsing a new lock
schema.

The authoritative physical writer fence is an owner-only regular file beneath
the verified `managedConversationsRoot/managedConversationLeaf` at
`sessionWriterLeaseLeaf`. Its durable schema-3 record is broker-MACed and
contains the session-route HMAC, conversation generation, state
`idle | live | delete-terminal`, owner/delete transaction ID, transition ID when
installed by a transition, and `routeAuthorityDigest`. A live owner includes a
bounded owner ID, PID, boot/process-start identity, hostname, acquired time, and
heartbeat for exact-dead proof; idle has no owner. The fence remains present
through normal close and resume and is removed only by the terminal cleanup saga.
Every managed append, heartbeat, handoff, close, takeover, archive, delete, and
recovery secure-opens this stored broker-private domain.

The physical fence and broker catalog are different persistence domains. Each
transition first creates or opens the private claim with no-follow/exclusive
rules, fsyncs the claim file and its parent directory, then validates the old
physical record and broker route. A broker CAS writes
`writer-transition-preparing` plus `WriterFenceTransitionIntent`. Its
`routeAuthorityDigest` is a domain-separated digest over the stable semantic
target only: schema/session-route HMAC, project/binding generation,
conversation generation, storage-plaintext digest and key ID, target lifecycle
state, target fence kind/owner/delete transaction, and the applicable
immutable fork transaction/source/expected-final-transcript identity. It
excludes archive state, mutable fork-publication phase/temp/final-file
observations, the writer-transition intent and phase, expected physical digests,
physical-record digest, AEAD nonce/ciphertext bytes, cleanup cursor, and other
mutable recovery state. The digest is computed once
for the prepared target and is copied unchanged into the final physical record
and terminal broker row, so neither representation depends on the other's full
serialization.

The helper writes and fsyncs a private temporary physical record, atomically
installs only the final target schema-3 record, and fsyncs the primary's parent
directory. It never publishes a separate physical `transition` schema. Retired
temporary/old names are unlinked handle-relatively and their parent is fsynced.
The broker intent then moves to `physical-installed`; a final broker CAS installs
the terminal route/fence state and removes the intent. Only after terminal CAS
may the claim be unlinked, and both unlink and parent-directory fsync are
mandatory. Recovery obtains the same claim and accepts only prepared-old,
prepared-new, or terminal-new combinations using the stable authority digest and
exact old/new physical digests. Before physical installation it may roll back;
after installation it only forward-completes. Claim create, primary publish or
replace, retired-name cleanup, and claim removal each have explicit
file-plus-parent-fsync crash tests.

The broker manifest owns an overflow-checked, globally monotonic conversation
generation counter. Because generations are never reused, a compacted terminal
row cannot make an old writer valid against a later conversation reusing its ID.
The broker catalog indexes the bounded `SessionRouteRecord` by
`HMAC(brokerKey, "session-route\0" + sessionId)`; collision or more than one live
route for a session ID fails closed.
One shared `SessionRouteResolver` is the only managed transcript locator. It
returns retained broker-private parent/leaf handles plus route/generation/fence
evidence, never an ambient-cwd path. `SessionService`,
`SessionTranscriptReader`, cursor code, ACP/serve replay, scanners, append/title,
managed fork, archive/unarchive, remove, usage salvage, and metadata cleanup all
consume it. Enumeration reads only routes authorized for the requested project
view. Every direct operation supplies a `SessionRouteAccessContext`; session ID
is never a bearer capability. A normal runtime context contains a live broker-
validated project binding lease and must exactly match the route's
projectStorageId and binding generation. A cwd rename is accepted only after it
resolves that same binding. Recovery, retirement, or deletion after project/
worktree removal uses a purpose-limited operator/maintenance lease and a separate
API; ACP, serve, UI, and ordinary `SessionService` callers cannot mint or borrow
it. A route for another project is returned as the same bounded not-found result
as absence, without leaking its project, and does not block that caller's own
same-ID legacy file. Legacy lookup occurs only after an authenticated proof that
the current project has no authorized managed route. For an authorized managed
route, a same-ID runtime legacy ghost is ignored. Direct consumers that bypass
this resolver are programming errors covered by import/call-site tests.

Managed transcript cursors use the closed `ManagedTranscriptCursorV2` schema,
not d9's workspace-key cursor. A broker-derived cursor key domain signs the
session-route HMAC, project ID and binding generation, conversation generation,
archive state, exact transcript file identity, bounded snapshot size/offset, and
last record ID. Decode first resolves the route through the caller's access
context, verifies the MAC/key ID and every route field, secure-opens the retained
file, compares fstat identity/size, and only then reads. Cwd changes cannot alter
the key. Archive movement, route compaction, a higher-generation reuse of the
same public ID, or inode/file-ID reuse invalidates the old cursor. The legacy
cursor decoder is reachable only after the same current-project no-route proof;
there is no format fallback after a managed cursor or route mismatch.

Managed creation never creates an ownerless private directory. Under the broker
lock it first completes the project identity/empty-authority bootstrap protocol
from Section 5.3 if this is the project's first managed conversation; failure
aborts session creation and does not fall back to a visible legacy conversation.
It then allocates the fresh session ID and generation, reserves broker and
project control/physical entry capacity, derives a deterministic conversation
leaf from the session-route HMAC and generation, and commits a bounded
`ConversationRootBootstrapIntent` with the retained managed-conversations parent
identity and an owner lease. Only then may the helper mkdir that exact absent
leaf, fsync the directory and parent, fstat it, and CAS the intent to
`root-published`. The encrypted route stores the retained parent plus leaf, while
the route row stores the observed child identity. A live owner can resume this
saga. An expired exact-dead owner with no published route may remove only the
intent's matching child, rmdir and parent-fsync it, then release the reservation;
an unknown occupant remains charged and recovery-required for explicit operator
repair, never guessed from a scan. Once the initialize route is durable, its CAS consumes the bootstrap
intent so the route becomes the sole directory authority.

Creation then writes the bounded encrypted `SessionStorageRoute` and prepares an
`absent -> live` initialize transition before creating the first transcript
byte. The private route contains only the managed conversation parent/leaf,
active/archive transcript leaves, writer-fence leaf, file-history leaf, and an
optional organization-cleanup root. Associated data binds session/project/
conversation generations, target route/fence states, plaintext digest, and
broker key ID. Plaintext paths are never stored outside the ciphertext or shown
to a model, log, hook, error, telemetry, or export; decrypted buffers are
zeroized after handle-relative descriptors are opened. After the physical fence
is installed but before the final active-route CAS, the empty transcript is
exclusive-created, its file and parent directory are fsynced, and its fstat
identity is stored in `transcriptFiles.active`. The final CAS requires exactly
that identity and only then makes the conversation listable or appendable. A
crash before visibility either resumes the exact create saga or removes its
private objects and route; it cannot fall back to legacy.

The encrypted plaintext and ciphertext are each capped at `16_384` bytes; every
string/locator has the normal authority depth/string limits. At most `256`
retained session routes may exist, each charged to broker control bytes/entries.
Each root-bootstrap intent reserves one of those same 256 session slots until
consumed or rolled back, so crashed creation cannot bypass the route cap.
Create/update reserves old-plus-temp bytes; deletion/recovery may use maintenance
reserve. The checked generation counter stops at `Number.MAX_SAFE_INTEGER`; the
next managed creation becomes unavailable instead of wrapping. AEAD failure,
wrong key/AAD, ambiguous session-route HMAC, or secure-open identity mismatch is
recovery-required and never falls back to current cwd.

Every authenticated sidecar envelope, its canonical digest/AAD,
`PersistedManagedMediaGroup`, delivery-group row, and chat record carries and
compares the same conversation generation. Restart moves idle to live, or
replaces an exact-dead live owner, through the same physical/broker transition;
it never allocates another generation. Every sidecar write, group/use adoption,
append, managed fork, rewind, archive, unarchive, and delete holds the fence and
compares the same route/generation at the broker/project/chat commit boundary.
Lock order is conversation fence, broker, then short project transaction. Normal
close drains appends and transitions live to persistent idle. Archive/unarchive
uses a recoverable route arm to rename between the two private leaves, fsyncs
both parents where distinct, and records exact file identities before terminal
CAS.

Managed fork/branch creates another managed conversation; a legacy source is out
of scope. While holding source and target fences in generation order, it creates
a hidden `fork-preparing` route. `ForkPublicationIntent.transcript` starts as
`planned` and names a deterministic private temporary leaf derived from the
transaction ID, the expected complete digest, the retained parent identity, and
an authenticated absent final leaf. The creation owner exclusive-creates the
temporary leaf, streams the transcript, fsyncs the file and parent, records its
fstat identity/length as `temp-published`, then atomically no-replace renames it
to the final leaf and fsyncs the parent again before recording `published`. It
next commits target sidecars/groups and file history. Recovery may remove only
the exact temp/final identity named by the intent, with parent fsync, or
forward-complete publication; an unknown partial occupant is conflict. A final
check re-reads all digests, hands off the creation owner, moves
`fork-preparing -> active`, and only then lists the target. CLI branch, ACP fork,
and future callers use this API; no caller directly copies a transcript.

A writer retains the fence across sidecar publication, group adoption, and chat
fsync, so delete cannot overtake an admitted group. Resume and owner handoff use
the two-domain transition. Archive/unarchive and fork cannot run in
`delete-preparing | deleting | deleted`.

Deleting a conversation is a separate persistent saga because the active and
archived chat JSONL files are themselves the evidence used above. Before
unlinking any transcript or sidecar, deletion acquires the exclusive conversation
fence, seals the writer, drains every queued append/adoption for the active
generation, and runs the writer-transition saga from live/idle to
`delete-terminal` with terminal route state `delete-preparing`. The physical
claim blocks acquisition throughout; a crash before physical install may roll
back to active, while a crash after install only forward-completes the broker
delete-preparing state. That state alone
makes the session non-resumable and rejects late generation CAS. A project
transaction then writes/fsyncs a bounded `ConversationDeleteIntent` with the
same transaction ID, conversation ID/generation, route digest, exact active/
archive file identities or authenticated absent verdicts, and canonical count/
digest snapshots of PolicyUse-owner keys and conversation groups. The broker
re-reads that intent and changes the route to `deleting`. Recovery from either
half uses transaction ID and route/intent digests to forward-complete; it never
returns to active after the writer was sealed. The deleting generation rejects
late owner/root/sidecar/chat CAS even after the intent is later compacted, and a
new route always receives a greater global generation.
If a valid chat remains, deletion appends/fsyncs its idempotent tombstone record;
a missing or corrupt chat remains governed by the external intent rather than
being treated as successful evidence. One or more bounded project transactions
scan the canonical groups and owner indexes. Each durable group atomically
becomes `deleting`: the transition removes its object roots and exact target
PolicyUse owners while retaining sidecar ID, expected digest/file identity, and
cleanup cursor. An unavailable group has no roots; deletion first completes any
`quarantine-pending` sidecar move, then removes only its exact owners and
correction metadata. The intent count/digest covers these concrete deleting rows,
not an undefined external index. A deleting row's `policyUseIds` is a canonical
audit set of the owners removed by the transition, not a strong reference:
validation requires the matching owner tuples to be absent, while a use row with
some other conversation owner remains live independently. Cleanup derives the handle-relative sidecar
path solely as `conversation-sidecars/<shard>/<sidecarId>.json`, opens it under
the retained project handle, validates digest/file identity, unlinks and parent-
fsyncs it, marks `unlinked-parent-fsynced`, then removes that row in a project
transaction. Only when every group row and owner digest is empty does the intent
become `project-clean`. The encrypted session route then drives handle-relative
cleanup of each active transcript, archived transcript, and the
remaining non-group targets, advancing an idempotent count/digest cursor.
The intent is removed only after all exact targets are absent, every remaining
digest is empty, and their parents are fsynced. Startup always forward-
completes the intent; an unlink failure leaves a tombstoned, non-resumable
session with its remaining targets identified for retry. Bulk deletion creates
and completes one such intent per conversation. No recovery decision relies
only on a record inside a file that the saga is authorized to delete. After the
project intent is clean, the broker route becomes `deleted` and retains the
encrypted route until the session-writer lease domain proves every holder of the
old generation released or expired with exact dead-owner evidence. Only then may
the terminal private-name cleanup below begin; the route and clean intent remain
until its final root-removal phase. The broker's monotonic generation high-water
mark remains. A suspended live writer delays cleanup but can never append
because its generation is sealed.

Terminal physical-fence removal retains its authority until every private name
is gone. Recovery obtains the physical claim, fsyncs its file and parent, and
records `terminalFenceCleanup.phase:'prepared'` in the retained deleted route.
It then unlinks the fence and fsyncs the parent before recording
`fence-unlinked-parent-fsynced`; next it unlinks the claim and fsyncs the parent
before recording `claim-unlinked-parent-fsynced`. A crash at any boundary
recovers from the retained route and idempotently advances. After claim removal
it verifies the exact conversation
root identity and authenticated emptiness, rmdirs it, fsyncs the managed-
conversations parent, and records
`conversation-root-removed-parent-fsynced`. Only this final phase may compact the
route and release the directory-entry charge. The route can never disappear
while an orphan fence, claim, or conversation directory still needs cleanup
authority.

Route schema validation is a closed discriminant: `fork-preparing` has exactly
one validated fork intent and live creation owner; `active` has no fork intent
and an idle/live fence; `writer-transition-preparing` has exactly one transition
intent and a physical old/new combination permitted by its phase;
`delete-preparing | deleting` have a delete-terminal fence and no fork/terminal
cleanup; only `deleted` may carry terminal cleanup. `absent` is legal only as the
old fence of initialize for a fresh broker-allocated conversation or managed
fork target. Active archive state requires exactly the active transcript
identity, archived requires exactly the archived identity, and moving/conflict
states carry only the exact old/new identity combination declared by their
archive intent. Initialize may have neither identity only before its final CAS.
No legacy-fence state is part of this schema.

Deletion preserves all managed `SessionService` consumers as explicit phases.
Before each surviving active/archive transcript is unlinked, usage salvage runs
under its existing best-effort contract with a delete-transaction idempotency
key; failure is recorded as attempted and never blocks deletion. Transcript and
managed-sidecar removal are mandatory handle-relative unlink plus parent-fsync
phases. Global file-history backup removal is likewise a mandatory
recursive handle-relative remove/fsync phase. Session-organization cleanup keeps
the existing warn-and-continue semantics but records an attempted completion bit
so crash recovery neither forgets nor infinitely retries it. The external intent
is cleared only after every mandatory phase and the best-effort organization
attempt are recorded.

A read-only preflight avoids creating v2 state merely to delete a legacy
conversation. The broker first looks up the session-route HMAC. A matching route
uses the managed saga only after the caller's project-runtime context matches;
an unregistered/retiring project instead requires the purpose-limited
maintenance delete context. Omni may be disabled, but an authorized managed
delete never inspects a same-ID runtime legacy file. Only a current-project
authenticated no-route proof permits the current `SessionService` to use its
exact legacy deletion path without creating broker/project identity. Corrupt,
unreadable, duplicate, or conflicting route/project/sidecar evidence fails
closed; an unauthorized foreign route is non-oracular not-found and cannot be
deleted.

The scheduler issues only the invocation ID before execution. After it captures
and validates the immutable `PolicyArtifactBatch`, the transaction assigns each
new attempt its stable `executionOutputId` and the invocation its `useOutputId`
in validated batch order; tools cannot provide or influence either ID. Reuse
loads the existing ordered execution IDs and derives only the new use-output
IDs. This supports bounded
dynamic cardinality such as `0..maxFrames` without speculative unused slots.
Each validated artifact's existing bounded `metadata.omniDisclosure`, when
present, is captured in that same output ref as `attachedDisclosure`; the owning
S5 entry retains the exact disclosure text. It is an atomic child of the artifact
output, not a fabricated second Tool artifact or adapter presentation. A
code-owned policy decision that omits the source or emits a standalone
disclosure uses a domain-separated decision slot and stores template ID/version
plus SHA-256 of its canonical bounded UTF-8 text in the entry-free output ref.
Retry/replay recomputes and compares that projection. An adapter-generated
disclosure that merely describes a neighboring media item is presentation, not
a second policy output: it stays adjacent, carries neither policy marker, and is
regenerated only with that validated media item.

`PolicySucceededCommit` returns results one-to-one by the transaction-assigned
`executionOutputId`, never by SHA-256. Each execution output gets its own
entry/File/ref/assertion/provenance even when several outputs share identical
bytes; only the managed object table deduplicates their physical storage. The
same transaction returns the invocation's ordered `useOutputId` mapping. All
orchestrator consumers join by `(useOutputId, executionOutputId)` and reject
missing, duplicate, cross-use, cross-attempt, or reordered result IDs.

Every binary/text-producing policy descriptor must declare
`storageDeterminism`; config cannot override it. This revision makes no claim that
a PATH-resolved ffmpeg/sharp runtime can be fingerprinted or bound exactly. All
first-slice ffmpeg, sharp/renderer, ASR, and external/model processors are
`nondeterministic`; their descriptor/tool version records harness semantics but
does not claim an exact system-binary build. A backed completed attempt remains a
valid cached artifact under its computation key. If backing is missing, a new
generation is allocated and no byte-equality assertion is made. Only a future
harness-owned pure byte operation whose executable/runtime is itself an
immutable managed input with bit-exact fixtures may declare `deterministic`.

Every file-producing descriptor also declares immutable `maxOutputBytes` and
`outputMode`. S4 artifact validation uses
`min(descriptor.maxOutputBytes, invocation reservation, code-owned absolute
ceiling)` rather than one global 256-KiB constant. Existing generic file tools
retain `262_144`; `omni-transcribe-audio-v1` version 2 declares `8_000_000`,
which is also the absolute text/file ceiling. The descriptor limit and output
mode enter the tool version/fingerprint. Limit plus one is rejected before
commit; full file objects, not truncated inline text, back S5 reuse/history.

If reuse finds a missing object, the tool descriptor controls recovery:

- a descriptor explicitly marked deterministic may rerun. If its complete
  ordered persisted output projection—kind, role, MIME, SHA-256, size, bounded
  inline text/disclosure, coverage, and semantic metadata—equals the recorded
  attempt, one v2 transaction restores objects/bindings without creating a new
  semantic result. A mismatch is a deterministic-contract violation and fails
  closed until the descriptor/tool version changes;
- a nondeterministic descriptor, including ASR, allocates a new generation and
  commits its new execution/entries/bindings through `OmniPolicySucceeded`.
  Older metadata remains historical; it never swallows the new output through
  the old `hash(sourceVersionId|omniConfigHash)` idempotency check.

This changes execution identity, not the two collection triggers. A missing
object is only a recomputation opportunity through this protocol; callers never
rerun and then submit outputs to an already committed v1 execution ID.

### 5.4 Persistent references and session envelopes

```ts
interface PersistentManagedMediaRef {
  schemaVersion: 2;
  issuer: 'qwen-code-omni';
  projectStorageId: string;
  fileId: MediaFileId;
  rootFileId: MediaFileId;
  fileVersionId: MediaFileVersionId;
  recognitionAssertionId: string;
  sha256: string;
  modality: MediaModality;
  mimeType: string;
  displayName: string;
}

type SessionMediaTarget =
  | { kind: 'persistent'; ref: PersistentManagedMediaRef }
  | { kind: 'ephemeral'; captureId: string };

interface SessionManagedMediaEnvelope {
  resourceId: string;
  target: SessionMediaTarget;
  managedObjectId: string;
  recognition:
    | { kind: 'persisted'; assertionId: string }
    | { kind: 'runtime'; verdictId: string; historicalAssertionId: string };
  modality: MediaModality;
  mimeType: string;
}
```

Only the harness creates these. External ACP, MCP, tool, hook, or provider Parts
are always untrusted ingress and cannot become a reference by matching JSON.
Persisted refs are accepted only from the harness conversation sidecar after
schema, issuer, project, Memory version, assertion ownership, backing object,
and hash validation.

`resourceId` exists only in the in-memory registry. Its lookup key includes the
FileVersion and current persisted-assertion or runtime-verdict ID. Resume validates a persistent
ref, freshly recognizes the pinned immutable object under the current runtime,
and binds a fresh handle to that runtime verdict. A genuinely new Session B receives no handle until
the user explicitly references the file again; locator+SHA lookup then reuses or
creates the right version and binds a new handle. Model disclosure contains only
current `resourceId`, media type, and bounded policy disclosure.

Every persistent bind is also a storage-liveness operation. Under the project
lock, the service revalidates the backed binding/hash, adds its object ID to the
issuing runtime's session lease, then inserts the registry mapping and only then
discloses `resourceId`. Failure to publish/refresh that root returns unavailable
and issues no handle. Descriptor pins and persisted sidecar roots are independent
references; releasing either cannot drop a live session handle. Registry
unbind, project switch, or session end removes the corresponding session-lease
root after revoking resolution. The cumulative taint ledger remains until
conversation disposal even after unbind.

The conversation vault admits at most `4_096` issued handles and
`2_000_000` UTF-8 bytes across handle strings, placeholder IDs, and exact taint
index metadata. Checked admission reserves the new entry before publishing its
lease root or registry mapping. Reaching either limit preserves every existing
entry and makes a new managed bind/delivery unavailable; it never evicts an old
taint that could still appear in later history. Resource unbind releases the
object lease but not this cumulative taint charge. Conversation disposal closes
new admission, waits for registry/matcher holders under their existing
last-holder rules, then releases the complete registry, taint ledger, and its
memory charge. These limits are independent of the per-turn media-part cap.

Durable and ephemeral roots are separate schemas. The canonical unique
`managedObjectIds` in each adopting or durable `DeliveryGroupAdoptionRecord`
are the conversation roots; there is no independently ordered per-object
`ConversationRootRecord` that could commit before or after its group. The group
record and all listed PolicyUse-owner transitions commit in one `memory-v2.json`
transaction and are removed by a branch/conversation tombstone while the project
remains registered. They have no session TTL and survive process death. The only higher-priority
authority is the broker's explicit unregistered-project retirement after 365
days, whose project transaction first makes every ref unavailable and removes
all roots before deletion. A `LeaseRootRecord { leaseId, ownerKind:
'registry'|'descriptor'|'transaction', ownerId, managedObjectId }` lives in the
owner-nonce/TTL lease and is reclaimed with that dead lease. A registry bind uses
the random `resourceId` as its owner ID; two handles or two Files sharing bytes
therefore create two roots. Unbind removes exactly that owner record. GC roots
are the union of durable conversation records and all valid ephemeral lease
records, derived under the project lock; an unrelated descriptor/session release
cannot drop a conversation or another handle.

If Memory commit fails, the current session may bind an ephemeral handle to the
request-local object. A session-only history overlay re-discloses that handle in
later tool rounds/turns of the same process. It never enters persisted chat,
export, compaction sidecars, or fork state; those contain an unavailable
placeholder. Session end clears the overlay/registry and releases its lease.

Runtime ownership follows project identity, not JavaScript prototype
inheritance. A project service owns exactly one storage ID, lock domain, Memory/
catalog document, and object store. Every live primary, ACP session, or subagent
has its own registry and session lease tagged with that project service; a
registry is never inherited from another `Config`.

- A same-project child receives a fresh registry/lease and may rebind validated
  persistent refs through the shared project service. Parent and child handles
  are different, and project GC sees both leases.
- A worktree or other project-root switch has a different project storage ID.
  Parent refs become unavailable in the first slice; no source-project broker,
  symlink, implicit CAS access, or inherited registry is allowed. The user must
  explicitly reference/copy/import the media in that project.
- `createPerAgentConfig` overrides the managed-media service and registry even
  when it uses `Object.create(base)`. A working-directory/project transition
  closes the old resolver lease, clears the old registry/overlay, resolves the
  new project service, and only then permits fresh binding. Returning to the old
  project likewise creates a new registry and fresh handles.

Resolver state and taint state are intentionally separate. Each session keeps a
cumulative in-memory issued-handle taint ledger until the conversation finally
ends. A project switch revokes old handle resolution and marks those ledger
entries unavailable, but never forgets their random strings; later compression,
bootstrap, fork, export, and tool-argument recording still replace them with
harness placeholders. Only session/conversation disposal clears the ledger.

An active conversation with any managed-media sidecar does not participate in
the existing cross-project session-artifact migration. Before a working-directory
or worktree transition, the recorder flushes and closes that conversation in its
source project, revokes its registry/lease, and leaves its transcript, sidecars,
and CAS roots there under normal deletion/retention rules. The destination
project starts a fresh conversation/session ID. Its bootstrap may receive only
the already sanitized visible text/checkpoint plus unavailable attachment
descriptors; it receives no persistent ref, source sidecar ID, CAS byte, or old
`resourceId`. If close/flush fails, the project transition fails before changing
cwd. Re-entering the source project resumes the old conversation through its
normal project-bound path; deleting it releases roots in that one lock domain.

Conversations with no managed-media sidecar retain the current migration
behavior. This deliberate split avoids a cross-project distributed transaction,
EXDEV multi-file ambiguity, and hidden cleanup authority while preserving the
required project capability boundary.

### 5.5 Runtime and persisted delivery groups

Policy semantic role and chat placement are independent:

```ts
type ManagedDeliveryItem =
  | {
      kind: 'presentation';
      text: string;
      templateId: string;
      subjectItemIndex: number;
    }
  | {
      kind: 'media';
      envelope: SessionManagedMediaEnvelope;
      artifactRole?: string;
      messagePlacement: MediaPlacement;
      policyUseId?: string;
      policyUseOutputId?: string;
      attachedPolicyDisclosure?: { text: string };
    }
  | {
      kind: 'text-artifact';
      text: string;
      artifactRole?: string;
      artifactStorageKind: 'text' | 'file';
      policyUseId: string;
      policyUseOutputId: string;
      attachedPolicyDisclosure?: { text: string };
    }
  | {
      kind: 'policy-disclosure' | 'policy-omission';
      text: string;
      policyUseId: string;
      policyUseOutputId: string;
    }
  | {
      kind: 'unavailable';
      reasonId:
        | 'missing-backing'
        | 'invalid-ref'
        | 'unsupported-current-profile'
        | 'retired-project';
      originalKind: 'media' | 'text-artifact' | 'policy-output';
    };

interface ManagedMediaDeliveryGroup {
  groupId: string;
  correlation: { messageId: string; partPath: string };
  rootFileId?: MediaFileId;
  sourceVersionId?: MediaFileVersionId;
  sourceRecognitionAssertionId?: string;
  items: readonly ManagedDeliveryItem[];
}
```

`artifactRole` is S5 policy semantics such as transcript/keyframe; it never
chooses a chat role. `messagePlacement` is selected by the code-owned ingress
and adapter and validated against the profile.

Durable history uses a second schema with no session capability:

```ts
type PersistedDeliveryItem =
  | {
      kind: 'presentation';
      templateId: string;
      subjectItemIndex: number;
    }
  | {
      kind: 'media';
      ref: PersistentManagedMediaRef;
      artifactRole?: string;
      policyUseId?: string;
      policyUseOutputId?: string;
      hasAttachedPolicyDisclosure?: true;
    }
  | {
      kind: 'text-artifact';
      entryId: MediaMemoryEntryId;
      fallback: '[Managed text artifact unavailable]';
      artifactStorageKind: 'text' | 'file';
      policyUseId: string;
      policyUseOutputId: string;
      hasAttachedPolicyDisclosure?: true;
    }
  | {
      kind: 'policy-disclosure' | 'policy-omission';
      text: string;
      policyUseId: string;
      policyUseOutputId: string;
    }
  | {
      kind: 'unavailable';
      reasonId:
        | 'missing-backing'
        | 'invalid-ref'
        | 'unsupported-current-profile'
        | 'retired-project';
      originalKind: 'media' | 'text-artifact' | 'policy-output';
    };

interface PersistedManagedMediaGroup {
  schemaVersion: 1;
  groupId: string;
  conversationGeneration: ConversationGeneration;
  correlation: {
    conversationId: string;
    branchNodeId: string;
    turnId: string;
    messageId: string;
    partPath: string;
  };
  rootFileId: MediaFileId;
  sourceVersionId: MediaFileVersionId;
  sourceRecognitionAssertionId: string;
  items: readonly PersistedDeliveryItem[];
}
```

The authenticated sidecar envelope and canonical sidecar digest/AAD include
`conversationGeneration` as well as the group tuple; a structurally valid old-
generation sidecar cannot be adopted, replayed, corrected, forked, or deleted by
a newer route. Each persisted media ref additionally records its own assertion ID. Every
policy-derived item carries its policy-use ID and use-local output ID; that use
row in turn authenticates the stable execution output. A raw source media item
carries neither, and the optional media pair is
all-or-none. Adapter presentation is a separate
discriminant and persists no free text: `templateId` must name a code-owned
versioned template and `subjectItemIndex` must point to the adjacent validated
media/unavailable item. Runtime text is regenerated from that template. Replay
validates that media refs match media outputs and text artifacts match both the
entry and `artifactStorageKind`. `hasAttachedPolicyDisclosure` must match an
attached projection on the same output ref; replay reads exact bounded text only
from that S5 entry, verifies its digest, and materializes it immediately after
the owning media/text item. `policy-disclosure`/`policy-omission` text matches
the recorded output template ID/version and canonical digest. It also validates the use's
source assertion and derivation edge. One output ref authorizes exactly one
policy-derived item; adjacent adapter presentation cannot invent or consume a
semantic output edge.
`MediaMemoryBinding`, `FileRecognizedCommit`, and policy source inputs carry the
same assertion ID and validate that it belongs to the stated FileVersion. S4
primary/additional artifacts, transcript-only results, omissions, disclosure
adjacency, and order survive record/replay. Resume validates all refs, binds new
session envelopes, and rebuilds the group as a unit; an invalid item becomes an
adjacent unavailable placeholder without reordering other items.

An unavailable item contains only those code-owned enums—never raw error, path,
hash, endpoint, or provider text. A replay-time substitution is runtime-only and
does not rewrite an otherwise valid sidecar; an initial sidecar/Memory failure
may persist the same bounded discriminant. Presentation subject validation
accepts only an adjacent media or unavailable item and keeps indices stable.

`text-artifact.fallback` is the exact code-owned constant shown above, never
entry text, preview text, transcript bytes, or provider output. Sidecar write,
import, and replay reject any other value. Full text lives only in its managed
object binding; `inlineText` remains separately bounded by the existing Memory
limit and is not copied into the delivery-group sidecar. Missing backing therefore
cannot bypass CAS retention/dedup through an unbounded fallback.

Chat placement is deliberately absent from the persisted schema. The current
adapter selects `messagePlacement` while building the runtime group; an optional
UI layout hint is non-authoritative and never enters profile validation.

The session registry also maintains the bounded conversation-vault taint map
above for every issued `resourceId`. Before user/assistant/tool messages,
recursive function-call args,
function responses, compression checkpoints, agent bootstrap, fork, or export
are written, the recorder replaces each known handle occurrence with a random
harness placeholder ID. A sidecar maps that ID to a persistent ref or to
`unavailable` for an ephemeral target. On replay, only sidecar-authenticated
placeholder IDs are replaced by freshly bound handles; model-authored lookalike
text is inert. This covers assistant handle echoes and tool args, not just media
Parts.

Conversation lifecycle is explicit:

| Boundary                           | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record/replay                      | Extend each recorded turn with stable `turnId`, conversation generation, placeholder map, ordered `groupIds`, and each group-adoption transaction ID. Prepare/fsync sidecars and atomically create the group root/use adoption before the exact chat JSONL append. A reader encountering any adopting member must forward-complete the whole group from record UUID and sidecar/root/use digests before exposing the turn; replay then validates and binds fresh handles. |
| Compression/microcompaction        | Extend the checkpoint with `turnId` and a structured attachment-recovery map independent of raw `Content[]`. The compressor cannot synthesize/drop this map; replay restores recorded group order.                                                                                                                                                                                                                                                                        |
| Agent bootstrap/resume/fork/branch | Carry recovery refs only when projectStorageId matches; each runtime binds independent handles/leases. Cross-project/worktree refs become unavailable. Resume and every transcript consumer resolve the broker route. Fork publishes its target only after the `fork-preparing` transcript/group/file-history/writer-handoff saga completes.                                                                                                                              |
| Rewind/dead branch/delete          | Rewind changes the active tail but does not release sidecars for any persisted node that remains a legal branch source. Fork re-signs correlation under the new conversation ID. A registered project releases the root only through a committed branch/conversation tombstone. Actual session-file deletion additionally requires the external `ConversationDeleteIntent` saga; project retirement first drains every nonterminal route through that same saga.          |
| Tokenizer                          | Count only the request-time materialized text/media estimate, not internal refs or object IDs.                                                                                                                                                                                                                                                                                                                                                                            |
| Hooks/UI                           | Trusted operator hooks receive only the sanitized model-visible payload but are outside the filesystem threat boundary. UI preview reads through the managed-media service and receives no internal refs/paths.                                                                                                                                                                                                                                                           |
| Export/import                      | Default export writes unavailable attachment descriptors, not objects or refs. A future explicit bundle import must copy and reissue project-bound refs.                                                                                                                                                                                                                                                                                                                  |

Sidecar create/update failure before chat append downgrades the current result to
the session overlay and may append only an unavailable placeholder with no
adoption reference; it never exposes a dangling durable ref. Append
acknowledgement loss is resolved by exact record UUID rather than guessed from
the caller's error. Delete failure retains a temporary root and is retried by
the tombstone/retention saga. Corrupt sidecars are quarantined and unavailable,
never partially replayed.

## 6. End-to-end pipeline

### 6.1 Eligibility and ingress normalization

`isOmniIngestionActive = conversationMode === 'managed' && omni.enabled &&
workspaceTrusted`. Conversation mode was finalized by the session factory before
the first append; this turn-level gate cannot upgrade a legacy conversation. A candidate gate
must pass before any source read:

```text
hasCandidateManagedRoute =
  (
    an enabled authorized profile natively supports a candidate source modality
    OR a statically guaranteed preprocessing route produces only text/omission
       or media supported by an enabled authorized downstream profile, and every
       external processor on every path has authorization
  )
  AND the packaged SecureFsRoot/secure-open native module loaded and passed its
      platform self-test
  AND the exact downstream route has a verified ManagedPhysicalClientAdapter
  AND frozen request-level stream/tools/tool-choice constraints are supported
  AND no reserved extra_body override is present
```

If either gate fails, the complete old per-media path runs with zero new capture,
URL localization, CAS, Memory, policy, or upload effect beyond an already
selected managed lifecycle. This rule covers unverified
custom providers, models whose `modalities` are true but have no code-owned
profile, and sources with no complete text/omission preprocessing route.
Disabling MiniMax media delivery blocks native/derived MiniMax media but does
not disable an independently authorized ASR route that is statically guaranteed
to leave only text. `omni.enabled=false` remains the complete rollback.
A reserved `extra_body` override is an invalid managed configuration and fails
locally; it is not an absent route eligible for legacy media fallback.

The static proof accepts only unconditional policies or conditions whose fields
are available before capture. Every path must omit the unsupported source,
include only text/omission/profile-supported outputs, use `onFailure: 'abort'`,
and have no skip/no-op/unmatched-selector branch. A resource metadata condition,
`onConditionUnavailable: 'skip'`, `onFailure: 'continue'`, or `source: 'keep'`
cannot authorize preprocessing of an unsupported source.

For local/inline input, a passing candidate gate permits only a bounded private
staging read/decode and content sniff. The exact gate is then recomputed from the
sniffed modality and frozen downstream/processor contexts. If it fails, the
snapshot is deleted and the old per-media representation path resumes inside
the immutable conversation mode; no CAS promotion, recognition fact, Memory,
policy, provider request, or durable media occurrence is created. Staging is the
sole media effect allowed for a false-positive filename/declared MIME; a managed
conversation's pre-existing lifecycle authority remains unchanged.

Exact proof is a request-plan barrier, not a per-part race. All candidate local,
inline, and explicit-URL sources for one physical downstream plan first acquire
candidate-spool budget and complete bounded private staging/sniffing in one
`0700` OS-temporary directory outside `.qwen`; filenames are random, files are
`0600`, writes are counting-sink bounded, and the whole directory is deleted on
false proof/abort. The spool contains no project identity, locator, credential
digest, or project lease; an already managed conversation may exist
independently. The native module opens a code-owned per-user transient root
relative to the OS temporary-directory handle, verifies ownership and `0700`
mode/ACL with no symlink/reparse fallback, and maintains one cross-process
`candidate-spool-v1` lock, reservation ledger, and owner lease domain. The hard
aggregate cap is `2_000_000_000` physical bytes per OS user and the same cap
applies to one plan; this intentionally narrows the sum of otherwise valid large
per-file routes. The ledger is rejected before allocation above `16_000_000`
bytes, depth `16`, `4_096` live-owner rows, `8_192` live plans, or `65_536`
filesystem entries. The spool also caps live directories at `16_384`. Every
file/directory entry costs at least `4_096` bytes or its allocated blocks,
whichever is larger; zero-byte files are not free. A reservation precedes every
create and written byte and atomically reserves byte, file, and directory-entry
counts. Its owner record contains boot identity, process-start token, random
nonce, reserved/written bytes, reserved counts, and heartbeat. Cleanup removes a directory only after the exact owner is
both expired and proven dead; a live or suspended owner is never age-swept.
Startup and every admission reconcile dead owners and physical files under the
transient lock. A malformed, oversized, or referentially inconsistent ledger
makes managed candidate routing unavailable with a constant diagnostic; it is
never reset and never initializes project state. The coordinator then proves every exact source route, processor
authority, provider context, and request-level stream/tools/tool-choice mode as
one immutable set before promoting any source to CAS or Memory. Failure deletes
the entire candidate directory, releases its reservation, and runs the complete
old per-media plan within the selected conversation mode. After exact success,
the already-managed conversation acquires authoritative project media
reservations for all staged bytes before transfer; a legacy conversation does
not enter this branch. Candidate and project reservations coexist until transfer into secure project staging has
finished and the candidate directory has been removed and fsynced; neither
budget treats the other as proof of capacity.
Final media count and
encoded/body limits remain post-policy checks because an authorized fixed policy
may omit or transform sources, but one fast part can never commit while a later
part still lacks exact eligibility.

Before any staging, the coordinator also walks the complete current ingress
attachment/tool-result tree plus selected managed-history media iteratively and
enforces code-owned structural admission limits: at most `64` structured nodes
under attachment-bearing roots, nesting depth `16`, `8` candidate media sources,
`8` explicit user URLs, and `128 * 1024 * 1024` estimated decoded bytes across
inline sources. Streamed local/URL sources instead reserve their full
route-bounded sizes against candidate-spool capacity before exact proof and
against project physical capacity only after that barrier. This in-memory inline
cap therefore does not contradict the DashScope 1-GB per-file profile. Ordinary text-only
conversation blocks do not consume this structural budget. A selected profile
may only narrow the media-source count. Base64 size is estimated in O(1) without
decoding. Exceeding any limit rejects the managed request plan before opening a
source, allocating a decoder, downloading, or spawning parallel work; it never
stages a prefix and then discovers the remaining tree. Capture is scheduled
through a fixed pool of at most `4` sources so attachment count cannot create
unbounded file descriptors, inodes, subprocesses, or CPU fan-out. These are
harness safety limits, not provider claims, and changing them requires a
versioned implementation constant plus boundary tests.

Ingress is classified by representation and origin:

- local path: TUI `@file`, ACP local resource, built-in `read_file`;
- explicit user URL: TUI `@https://...`;
- inline bytes: ACP initial/mid-turn attachment and top-level/nested tool media.

Tool `fileData`/resource-link URLs keep their old behavior and are not fetched.
An explicit user `@URL` is consent to localize. Because trustworthy modality
sniffing needs bytes, URL handling is two-stage:

1. only after `isOmniIngestionActive`, `hasCandidateManagedRoute` for at least one
   candidate modality, current trust, and explicit consent pass, perform the
   existing SSRF-safe HTTPS download without any provider credential; cap it by
   the minimum of a positive configured localization cap, candidate-spool
   remaining capacity, the per-plan candidate cap, and the largest source
   accepted by the enabled route/policy. Project remaining capacity is checked
   only after exact proof, before transfer into v2;
2. sniff the private downloaded bytes and re-run the exact gate before
   recognition/CAS. Unsupported results delete staging, retain the old URL
   text/error outcome, and create no FileRecognized fact.

The first slice performs one complete bounded download; it does not add Range
sniff/restart semantics. Redirect/DNS pin/proxy rejection/header/idle/byte checks
apply on every hop. One code-owned monotonic `1_800_000` ms absolute deadline
starts before the first DNS resolution and is never reset by a redirect or body
chunk; disabling the idle watchdog does not disable it. Deadline abort closes
the reader/socket and releases candidate reservation, staging, and fds.
Redirects never carry provider credentials, and trust/config revocation aborts
the download.

Localization freezes a `SourceLocalizationTransportContext` before DNS. It
contains config epoch, a proof that proxy use is disabled, global-dispatcher
identity, literal `rejectUnauthorized:true`, DNS policy version, and the absolute
deadline. After each asynchronous DNS resolution and redirect decision, the
downloader revalidates proxy/global dispatcher/TLS/config state and constructs a
fresh direct Agent with explicit certificate verification. The final recheck and
physical fetch have no intervening await or mutable global lookup. Any change
aborts before dispatch and releases all resources; source URLs never inherit the
provider dispatcher or environment TLS relaxation.

### 6.2 Downstream request planning and policy processors

Routing has two levels:

1. freeze the candidate downstream route (primary, Vision Bridge, or subagent)
   used for S4 `session.*` conditions, even if that model cannot consume the
   source modality but a preprocessing policy can turn it into text/omission;
2. give every external policy processor its own code-owned endpoint/credential
   context, then resolve a delivery adapter for each remaining media output.

Thus MiniMax plus an explicitly configured audio transcription policy can send
audio to the authorized ASR processor, commit a transcript, and send only text
to MiniMax. The ASR key/header/body never enters the MiniMax request. A processor
without an authorized context follows the policy's configured failure semantics
and cannot borrow another provider credential.

External processors use a separate type rather than `MediaTransportProfile`:

```ts
interface ResolvedProcessorContext {
  requestId: string;
  configEpoch: string;
  processorId: 'omni-transcribe-audio-v2';
  profileVersion: 2;
  authority: 'builtin-verified' | 'operator-explicit';
  requestScope: InferenceScope;
  modelId: string;
  authType: 'bearer';
  credentialSourceOwnerId: string;
  credentialInstanceId: string;
  tlsVerification: 'required';
  physicalClientAdapterId: 'openai-managed-v1';
  requestProfileId: 'qwen-omni-asr-v2';
  requestProfileVersion: 2;
  responseProfileId: 'dashscope-qwen-omni-asr-v1' | 'standard-openai-stream-v1';
  responseProfileVersion: 1;
  sourceMimeTypes: readonly ['audio/wav', 'audio/mpeg', 'audio/aac'];
  maxInputBytes: number;
  chunkSeconds: number;
  maxDecodedChunkBytes: number;
  maxEncodedAudioFieldBytes: number;
  maxPromptUtf8Bytes: number;
  maxRequestBodyBytes: number;
  maxResponseBytes: number;
  maxSseLineBytes: number;
  maxSegmentTranscriptUtf8Bytes: number;
  maxTranscriptUtf8Bytes: number;
  maxSegmentCount: 512;
  chunkConcurrency: 3;
}

type CandidateProcessorContext = Omit<
  ResolvedProcessorContext,
  'credentialInstanceId'
> & { credentialHandle: 'secure-unread-opaque-handle' };
```

The processor v2 physical-request limits are code-owned:

| Constraint               | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| source formats           | WAV, MP3, or AAC only; FLAC/OGG/M4A/other formats cannot authorize this route                     |
| source admission default | `10_485_760` decoded bytes; larger sources require bounded chunking                               |
| chunk duration           | default `180` seconds; operator range `30..1800`                                                  |
| segment count            | at most `512`, checked before allocating outcomes, subprocesses, or promises                      |
| chunk concurrency        | code-owned worker pool of at most `3`; operator settings cannot widen it                          |
| chunk encoding           | AAC/ADTS with exact `audio/aac` data-URI prefix; never M4A                                        |
| decoded physical chunk   | per-prefix derived maximum satisfying the strict encoded-field formula below                      |
| encoded audio field      | strictly `<10_000_000` UTF-8 bytes, including the exact `data:audio/...;base64,` prefix           |
| prompt/language          | `4_096` UTF-8 bytes                                                                               |
| serialized request body  | `15_000_000` UTF-8 JSON bytes                                                                     |
| streamed response        | `2_000_000` raw bytes per physical request; `262_144` bytes per SSE line                          |
| segment transcript       | `1_000_000` UTF-8 bytes                                                                           |
| invocation transcript    | `8_000_000` UTF-8 bytes across all chunks, labels, and disclosure                                 |
| wire tuple               | exact frozen `POST <baseUrl>/chat/completions`, `stream:true`, `modalities:['text']`, no redirect |

`maxInputBytes` is source admission, not permission to exceed a physical
request cap. An operator may raise it for chunked input, but each produced chunk
must satisfy all hard limits above; a single over-limit interval is re-encoded
as AAC/ADTS or rejected before network I/O. For each allowed MIME, the decoded
cap is the largest `n` for which
`prefixUtf8Bytes + 4 * ceil(n / 3) < 10_000_000`; the estimate is checked before
base64 allocation, then the actual field and final JSON UTF-8 bytes are checked
again. The official AMR/3GP/3GPP formats remain outside this conservative first
profile until recognition and fixtures support them exactly.
The response is decoded incrementally rather than through unbounded
`response.text()`: raw bytes and line bytes are counted before parse, and UTF-8
transcript bytes are counted while concatenating chunks. Crossing any cap aborts
the response, produces no partial transcript artifact, and follows policy
failure semantics. All concurrently running chunks share one invocation-owned
atomic UTF-8 quota; every delta reserves bytes through its serialized `claim()`
before append, and labels plus final disclosure use the same counter. Exceeding
the remaining aggregate cancels every chunk and commits no partial artifact.
The `512` segment limit is checked before allocating outcomes, ffmpeg work, or
network promises. A fixed pool runs at most three chunks, preserves ordered
aggregation, and on abort cancels all workers and starts no later segment.
Operator settings cannot widen these response/output caps.

`qwen-omni-asr-v2` freezes the complete request grammar: one user message with
exactly two ordered parts (`input_audio`, then bounded text); the audio object
has exactly `data` and `format:'aac'`; its data URI prefix, decoded length, and
SHA-256 are bidirectionally matched to the pinned chunk; `modalities` is exactly
`['text']`; `stream` is exactly `true`; `model` is the frozen processor model;
and `tools`, `tool_choice`, `n`, image/video parts, reasoning/audio-output
fields, unknown top-level fields, and user overrides are forbidden.
`stream_options` is absent in v2. This processor request profile, not the
media-free provider-inference rule, validates each chunk; the shared base
validator still enforces endpoint, method, auth owner, config epoch, limits,
headers, logging, retry, and transport.

The existing ASR `model/baseUrl/apiKeyEnv/maxInputBytes/chunkSeconds` override is
preserved only as `operator-explicit` authority from trusted resolved settings:
the exact HTTPS method/URL/model/env-key owner and source caps are frozen;
unknown URL, missing owner, or epoch change rejects the processor route. The
code-owned physical request caps above always clamp operator settings and cannot
be widened by them. A configured secret is sent only to its paired exact
endpoint. The current public DashScope default remains a disabled
`builtin-candidate`, not `builtin-verified`, because current Qwen-Omni inference
documentation publishes workspace endpoints. It cannot satisfy static route
proof or create a `ResolvedProcessorContext` until its exact public ASR tuple
passes credential-gated E2E; failure removes the candidate. Existing S4 legacy
behavior remains available outside the managed route. Each physical chunk uses
this context, its exact processor request profile, and the shared transport/auth
final validator with automatic POST retry disabled; no arbitrary environment
variable is inferred from a model or provider name.
The built-in route binds `dashscope-qwen-omni-asr-v1`; an operator-explicit route is
assigned `standard-openai-stream-v1` by code and cannot configure a parser. An
endpoint whose response fails that strict profile is unavailable/legacy. Both
profiles are defined below and participate in candidate/exact proof and config
epoch.

Processor response and transcript bytes are credential-tainted data until
proven otherwise. The incremental decoder maintains a cross-chunk matcher for
the exact owned secret and `Bearer <secret>` across byte/SSE boundaries, and the
complete bounded transcript/disclosure is scanned again before any staging,
Memory, log, UI, or model-visible commit. A match cancels all chunks, discards
the output, reports only a constant sanitized policy error, and never persists
the raw response. Secure credential bytes are not copied into diagnostics or
the fingerprint.

One logical turn is partitioned into actual external request plans. Before fixed
policies run, each plan collects all source roots and rematerialized history
items that may enter that request. Policies execute in barrier waves. At the
start of every fixed-policy wave, the coordinator sorts all pending roots by
correlation key and rebuilds one `request.*` namespace, including aggregate
estimated media tokens. That namespace is immutable within the wave; all
outputs commit before the next wave recomputes it. Derivative inclusion or
omission can therefore change the next wave without root-order races. Transport
guard policies run sequentially by declared priority under the same aggregate
rule.

After candidate staging/sniffing proves the whole exact route and v2 identity is
available, each downstream request derives/freeze its exact provider route and
credential instance. Media profile data is present only if media remains after
preprocessing:

```ts
interface MediaDeliveryContext {
  requestId: string;
  configEpoch: string;
  providerRoute: ResolvedProviderRoute;
  mediaProfile?: {
    id: MediaTransportProfile['id'];
    version: 1;
  };
  streaming: boolean;
  toolsPresent: boolean;
  toolChoiceMode: ToolChoiceMode;
}
```

A text-only result may therefore use an existing downstream provider route with
no media profile only when that exact route has a verified physical-client
adapter (`openai-managed-v1` in this slice). If any media survives preprocessing, absence of
`mediaProfile` is a local omit/failure and no media reaches that request.
The candidate and exact gates compare `streaming`, `toolsPresent`, and
`toolChoiceMode` with the selected model capability before source capture.
`streamingMode:'required'` rejects false/absent streaming,
`streamingMode:'forbidden'` rejects true, and `optional` accepts either; the
final validator independently derives the actual serialized/SDK streaming mode.
For MiniMax v1, `required` or `none` tool choice makes managed media unavailable
before any staging/CAS/Memory effect; it cannot fall through to a less
constrained managed route.

If a full sniff contradicts a candidate modality, planning restarts before a
policy processor or provider request. All later policy context, guard, cache,
materialization, and final validation consumes the same frozen context rather
than mutable global `Config`.

### 6.3 Immutable capture and source recognition

Candidate capture applies ingestion/project admission limits, not adapter
transport caps:

1. Apply the candidate route gate and cheap safety preflight. Local sources use
   only lexical workspace/extension checks—never path-following `stat`; inline
   sources use `approxBase64Bytes()` before decode; URLs use Section 6.1. Reserve
   tool-media part/aggregate processing budget as soon as a qualifying part is
   selected. Before URL download or inline decode, atomically reserve the
   bounded source upper limit in the cross-process candidate-spool budget; a URL uses
   its effective download cap and inline uses the conservative decoded estimate.
2. Recheck current trust, `omni.enabled`, and frozen config epoch. Open a local
   source once through `openAuthorizedWorkspaceSource`: it never uses the
   `WorkspaceContext` cached-realpath result. Slice 1 adds one narrowly scoped
   N-API module exposing `secureOpenBeneath(rootHandle, relativePath)` and the
   internal `SecureFsRoot` operations enumerated in Section 5.3, with no
   general-purpose arbitrary-path API. It rejects absolute/empty/dot/dot-dot components and every
   symlink, junction, reparse point, or magic link. Linux uses
   `openat2(RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS)`;
   macOS walks each component from an opened root dirfd with `openat` plus
   `O_NOFOLLOW` (intermediates also require `O_DIRECTORY`); Windows performs the
   equivalent root-handle-relative NT open and rejects reparse points. The final
   flags include read-only, close-on-exec, and nonblocking where supported. The
   helper returns one owned handle plus platform file identity only after the
   final target is a regular disk file. FIFO, socket, device, directory, symlink,
   and any beneath-proof failure occur before a content byte or staging file and
   are ingestion-security verdicts: they fail the target closed and the path is
   never reread through legacy fallback. There is no `realpath + open` fallback.

   The addon is N-API-version pinned and ships the same supported macOS/Linux/
   Windows architectures as the CLI. Missing, unloadable, unsupported, or
   self-test-failing native binaries make every managed route unavailable before
   candidate staging: local, inline, and HTTPS all run their complete
   independently authorized pre-managed path and never touch v2. A
   target-specific helper rejection remains an ingestion-security verdict and
   never falls back. The module's surface, platform flags, packaging/signature
   checks, and adversarial directory-swap fixtures are part of Slice 1 acceptance
   rather than an optional hardening follow-up.

   Validate the fd size against route/structural limits and atomically reserve
   that exact size in candidate budget before reading a byte or creating staging.
   Compare
   dev/ino/size/mtime/ctime before and after. Hold the source handle throughout
   the copy. Stream only the initial reserved `fstat.size` bytes into
   an exclusively created file under a `0700` staging directory with mode
   `0600`, computing SHA-256. Retarget, replacement, growth, shrink, or metadata
   mutation aborts the whole capture.

3. Decode inline data only after O(1) estimate passes; stream through the same
   staging/hash path and recheck actual decoded size.
4. Content-sniff the private snapshot and recompute the exact route. A mismatch
   or unsupported result deletes staging and returns to the pre-change path
   before durable/external effects.
5. Probe/recognize the exact-route snapshot under a frozen detector/config/
   probe identity, then rehash and re-stat it. Any change discards recognition.
   Before promotion, construct and canonicalize the complete proposed
   `FileRecognized`/assertion/object-binding state. Under the project lock,
   reserve its exact old-plus-temp control-document growth as well as bytes and
   filesystem-entry counts for the unique object, CAS temp/final entries, and
   shard directory when new. Run GC first; insufficient control, byte, file, or
   directory-entry capacity enters the explicit session-only ephemeral branch
   before CAS promotion. The source transient reservation remains held.
6. Set the snapshot read-only and atomically promote/dedup under the project
   lock; promotion verifies the same hash. Apply recognition/ingestion safety
   policy. In one atomic
   `memory-v2.json` transaction, commit `FileRecognized` with the logical
   locator, independent File provenance, matching recognition assertion, and
   managed object/binding. The
   The earlier control reservation proves that settled admission fits; only an
   unexpected I/O/transaction failure may leave an unreferenced charged object
   for cleanup, never a graph row without catalog backing. This true fact
   remains even if later delivery policy omits/rejects the source. Only after
   promotion/commit or dedup binding is complete and staging is deleted does the
   lease release the source transient reservation; commit keeps the object
   charge, while abort/crash recovery releases or reclassifies both under the
   dead owner's lease.

Reservation is enforced before bytes hit disk, not merely checked after a tool
returns. Every staging, download, policy-output, CAS-tmp, and private-snapshot
copy uses a reservation-scoped counting sink. Its `write()` rejects a chunk
before `written + chunk.length` exceeds the live reservation; increasing a
limit requires a successful atomic expansion under the project lock before the
next write. Local capture reads exactly the initially reserved fd size and never
chases appended bytes. URL bodies are streamed through the same sink.

Code-owned policy tools no longer receive an unrestricted output directory.
Their versioned `outputMode` is one of `streamable-single` or
`bounded-multi-stream`; all currently shipped transformations are adapted to a
quota-counted stdout protocol. Sharp/image and audio outputs are direct streams.
MP4/M4A clip/downscale outputs use a documented fragmented-container profile
(`frag_keyframe+empty_moov+default_base_moof`) that is non-seekable and gets a
new tool version/fingerprint; profile/fake/real tests must accept those exact
bytes before the new version is enabled. Existing `+faststart` cache entries are
not reused across that version change. Keyframe extraction runs at most the
descriptor's bounded count of deterministic one-frame subprocesses, each using
an image pipe, rather than a `%04d` path pattern. If a transformation cannot
preserve its declared semantics through one of these bounded modes, it is not
enabled in this slice.

The harness kills a child on quota/timeout and owns each stdout sink. ASR/text/
disclosure writers use the same incremental UTF-8 sink. Each descriptor
publishes an immutable maximum physical output size/count no larger than the
orchestrator reservation, and operator settings cannot widen it. Partial output
is removed or transferred to quarantine; it is never promoted. Before the
staging-to-quarantine rename, one broker/project transaction journals the exact
ownership reclassification from transient to quarantine while retaining the
same aggregate physical byte/entry charge. Crash recovery recognizes only the
journaled source-or-destination identity and releases that charge exactly once
after successful unlink/fsync. If the project's quarantine cap or the broker's
aggregate pool cannot own it, the partial is deleted under its transient charge
rather than moved. No subprocess may open an arbitrary staging output path and
exceed the reservation before a post-hoc `stat`.

Every object-to-byte consumer uses one non-wire service operation,
`openPinnedMediaTarget(harnessTarget, consumerLease)`, which returns:

```ts
interface PinnedManagedSnapshot {
  fd: FileHandle;
  snapshotPath: string;
  sha256: string;
  sizeBytes: number;
  release(): Promise<void>;
}
```

Under the project lock it resolves the committed version/entry binding and
object record for a persistent target, opens the CAS object relative to the
stable `SecureFsRoot`/objects handle with no-follow component rules,
records `fstat`,
atomically reserves `sizeBytes` of transient snapshot capacity, and publishes
the object plus a private-snapshot ID in the caller's lease before GC can run.
After releasing the lock, it copies from that same source fd into a lease-owned
`0600` snapshot while fully hashing, verifies size/hash and pre/post `fstat`,
marks the snapshot read-only, and returns the descriptor above. Failure closes/
removes the snapshot and releases its lease entry before any byte is exposed.

An observed CAS size/hash mismatch is storage corruption, not an ordinary pin
miss. The consumer closes its unexposed snapshot and, under the project lock,
revalidates the catalog generation, object-path identity, current file identity,
and all live pins. With no conflicting live writer it follows the same charged
state machine as GC:
`managed -> deleting(corruptionNonce) -> same-filesystem tomb + fsync -> missing`;
the same transaction advances object generation, making every old remote/
delivery/degradation cache row unauthorized without requiring a cross-file
atomic delete.
Existing readers that pinned an earlier verified fd finish; no new pin starts
from `deleting`. Tomb bytes remain charged until unlink+directory fsync, and
startup can resume every crash boundary. The resulting `missing` binding enables
the deterministic rehydrate or nondeterministic-generation protocol above.

An ephemeral envelope takes the other branch of the same API. Its unforgeable
`captureId` is resolved only in the issuing session registry to a verified hash,
size, source lease, and private object/snapshot identity; no caller-supplied JSON
or path is accepted. Before the request lease is released, continued same-session
use atomically transfers that root into the session lease and then binds the
capture ID. The API reopens/copies/hashes that lease-owned target under the same
quota and inode checks, without inventing a catalog/Memory row. Transfer failure
allows only the already pinned current request to finish and exposes no reusable
handle. Session end destroys the registry entry, snapshot/object, and lease root.

Policy input and reuse, provider/history materialization, media-policy tools,
session recall/replay, UI preview, and verified backfill all use this API; none
reconstructs an object path or performs its own `lstat`/read sequence. Adapters
read only the returned snapshot fd. Existing code-owned sharp/ffmpeg/path-based
Policy Tools receive only the lease-owned read-only `snapshotPath`, never the
CAS path; the path remains valid until `release()` after every child process and
reader closes, then is deleted. DashScope uses a multipart writer backed by the
fd rather than `openAsBlob(path)`. No consumer or provider sees a byte until
identity validation succeeds, and GC cannot sweep the source or private
snapshot while the descriptor is live. The implementation uses a normal private
filesystem path on macOS, Linux, and Windows; it does not depend on `/dev/fd`,
`/proc/self/fd`, or inherited child descriptors.

`snapshotPath`, tool staging/output paths, and CAS paths are harness-secret
location data. A Policy Tool receives a separate bounded `displayName`; it may
not construct user-visible text from a private path. Child exit status maps to a
code-owned reason enum, and raw stderr/stdout diagnostics never flow directly to
model text, UI, hooks, Memory disclosure, or logs. Before any diagnostic crosses
that boundary, one centralized scrubber replaces exact private paths plus their
file-URI, slash-normalized, and JSON-escaped forms with `<managed-media>` and
applies the existing credential sanitizer. Unknown tool failures expose only a
constant error and the safe display name. Tests inject each encoded path form
across chunk boundaries and assert that neither the path nor a parent directory
is observable.

`raw-resource-v1` describes the recognized resource, not provider billing. A
derived overview has its own estimate/version. Adapter byte/MIME/body caps are
not checked here because a fixed policy may legally transform an oversized or
unsupported source into valid final candidates.

A request-local ingress registry keyed by tool call ID and complete part path
carries an already captured built-in `read_file` handle to the scheduler. No
wire `Part` receives a private marker or path. External tool media without a
registry entry is captured once at the funnel.

Model/client Policy Tool declarations expose only `resourceId` plus semantic
arguments for a request admitted to the managed route. Caller-supplied
`inputPath` and `outputDir` are removed from that model, Core scheduler, and ACP
`Session.runTool()` declaration; the gate resolves the handle to a
`SessionMediaTarget`, and only the runner injects the pinned private path and
quota-owned output sink. A raw local path reaches a managed Policy Tool only
after structured ingress captures it through `secureOpenBeneath` and issues an
ephemeral handle. Omni-off and no-candidate legacy plans retain their complete
pre-change schema/behavior. On a managed plan, a raw path or output directory
arriving through untrusted JSON is a local validation error, never a shortcut
around capture, lease, quota, or path scrubbing.

The scheduler creates a private, non-wire `ManagedPolicyExecutionContext`
before it materializes a source snapshot:

```ts
interface ManagedPolicyExecutionContext {
  source: MediaMemoryBinding;
  recognitionAssertionId: string;
  recognitionKind: 'persisted' | 'runtime-verdict';
  outputReservationId: string;
  outputLeaseRootId: string;
}
```

The context, not `inputPath`/`outputDir`, travels with `PolicyArtifactBatch` to
collection. It is signed by the scheduler invocation and resolved from the
project service; external tool results cannot construct it. Collection obtains
source File/version/assertion and output containment authority only from this
context. It never calls `resolveByFileRef` or recognizes a lease snapshot as a
new user File. Fixed and model/client policy paths use this same shape.

A recalled/resumed handle whose current safety evidence is only
`runtime-verdict` may execute policy solely in the existing session-only
ephemeral branch: no `OmniPolicySucceeded`, reusable attempt, persistent entry,
or durable group is written. To create durable policy results, the user must
explicitly re-reference the source so the normal `FileRecognized` trigger
persists the current assertion and issues a persisted-assertion handle. This
keeps read-only recall and the two existing collection triggers intact.

### 6.4 Side-effect checkpoints and failure semantics

The implementation uses one checkpoint helper that verifies current trust,
`omni.enabled`, frozen config epoch, and operation-specific authorization:

| Boundary                                          | Extra requirement                                   |
| ------------------------------------------------- | --------------------------------------------------- |
| Source read / staging create                      | ingress eligibility and workspace path policy       |
| URL request and every redirect                    | explicit user consent and SSRF/localization policy  |
| Capacity reservation / CAS / Memory commit        | project lock, storage identity, owner lease         |
| Managed object pin / private snapshot             | matching project service, committed binding, lease  |
| Policy process spawn, file write, or network call | resolved policy descriptor and processor context    |
| Provider upload and each retry                    | adapter endpoint/credential scope                   |
| Inference `fetch` and each retry                  | exact delivery context and final request validation |

Revocation aborts in-flight work through its signal, removes staging, prevents
later commit, and never mixes old/new configuration.

Failure behavior:

- User abort propagates.
- Ingestion safety and transport/policy/final-validator verdicts fail closed.
- Local read/mutation failure returns the existing read failure and never rereads
  a mutable path for fallback.
- Optional recognition failure after immutable capture may use the same snapshot
  only for an enabled inline adapter when no positive token guard or fixed policy
  requires recognition. It creates no Memory/durable history.
- Memory failure enters an explicit ephemeral branch. Policies may run against
  the request-local object, but they never call `OmniPolicySucceeded`, read/write
  the reuse index, or create persistent entries/versions. Their outputs and
  lineage live only in the session overlay/in-flight lease; persisted history is
  unavailable. This rule applies to every admitted fixed/guard policy;
  `onFailure` continues to describe tool/policy execution only, and this slice
  adds no durable-only policy switch.
- If source collection succeeded but a later `OmniPolicySucceeded` transaction
  fails, the persistent source remains valid while every output of that failed
  transaction (including guard outputs) is downgraded together to the
  session-only ephemeral branch. It is excluded from reuse and persisted groups,
  delivered only under its lease for the current session, and unavailable on
  resume. No output is partially committed.
- URL failure preserves the old URL text/error and creates no identity.
- Adapter transfer failure never selects another adapter. Existing inline tool
  bytes may retain only their exact pre-change transfer fallback after the same
  profile validator accepts them; guard failures never fall back.

### 6.5 Fixed policies, overview, and transport guard

After source `FileRecognized`, S4 fixed preprocessing policies run against the
frozen downstream request namespace. Before spawning a file-producing tool, the
coordinator reserves its code-owned maximum derived-byte budget, descriptor
maximum output-file/directory counts, and a conservative maximum control-row
projection as one transient lease. All outputs of one invocation are staged and
hashed within that reservation. Before any promotion, under the project lock the
coordinator canonicalizes the exact proposed `OmniPolicySucceeded` transaction,
reconciles the conservative control reservation to exact old-plus-temp growth,
deduplicates object IDs, counts the whole batch's genuinely new bytes and
filesystem entries, runs GC, and atomically adds one object reservation while
retaining the transient output reservation through every copy/rename. If any
control, byte, file, or directory-entry dimension does not fit, the whole
invocation follows its policy failure semantics; no subset promotes or commits.
Two processes include each other's live multidimensional reservations when
testing every cap.

With both reservations held, each binary output is promoted, recognized, and
committed as its own FileVersion or policy-entry object binding. In the
persistent branch, `OmniPolicySucceeded` atomically commits the execution, text/
file entries, derivative versions, lineage, object records, and bindings in the
same v2 document; reuse follows the S5 v2 computation-family/generation protocol
while preserving each File/provenance. A failed document transaction leaves
only reserved orphan candidates for cleanup, never a partial graph/catalog
pair. After document commit and staging deletion, the transient reservation is
released and the committed objects remain charged; abort/crash recovery removes
or reclassifies both reservations under the lock.

The existing image overview becomes a complete built-in S4 policy. It is
inserted in a code-owned compatibility prelude before user fixed-policy waves,
cannot be overwritten/tombstoned by settings, and applies only when the ingress
surface would set today's `shouldRenderImageOverview` and the resolved profile
is MiniMax. Its tool descriptor is `builtin-internal`: config normalization
rejects this tool name in user fixed policies and model/client access, so its
execution origin cannot collapse with a user policy that happens to use the
same computation fingerprint:

```ts
const minimaxImageOverviewPolicy: NormalizedFixedPolicy = {
  id: 'builtin.minimax-image-overview-v1',
  priority: 0,
  mediaTypes: ['image'],
  origins: ['user', 'tool'],
  onConditionUnavailable: 'run',
  toolName: 'omni_render_image_overview',
  arguments: {
    rendererVersion: 1,
    maxDimension: 'current-renderImageOverview-default',
    jpegQuality: 'current-renderImageOverview-default',
    animationPolicy: 'current-renderImageOverview-default',
  },
  maxRunsPerLineage: 1,
  onFailure: 'continue',
  output: {
    reprocessMedia: true,
    source: 'omit',
    artifacts: { 'kind:image': 'include', '*': 'retain' },
  },
  stage: 'preprocessing',
};
```

The tool descriptor version and all concrete renderer constants, not the
descriptive strings above, enter the resolved-argument fingerprint. It never
matches its `origin: 'policy'` derivative, preventing recursion. A non-size
`ImageViewError` is a normal failure, so `onFailure: 'continue'` keeps the raw
source exactly as today. `source_too_large` and `output_too_large` are classified
by the code-owned runner as nonrecoverable compatibility errors before generic
`onFailure`, preserving the current hard-error result. ACP/direct tool inline
surfaces that do not currently call `renderImageOverview` never receive this
prelude.

It preserves current source/renderer limits, resize/re-encode behavior, JPEG
output, displayed dimensions, and zoom hint. The JPEG receives a version/hash/
object and `DERIVED_FROM` edge; overview text is adjacent disclosure. The normal
S5 policy transaction and reuse path records the descriptor and resolved args.

Only after the fixed-policy delivery group exists does the adapter transport
guard evaluate final media candidates:

1. check adapter MIME, decoded per-item size, placement, any non-null profile
   duration cap, profile image width/height/aspect constraints using recognized
   dimensions (missing required dimensions fail closed), and positive
   `omni.processing.transportGuard.maxEstimatedTokens` against each candidate;
2. if over, run applicable S4 transport-guard policies, recognize/commit their
   outputs, then return every new occurrence to the fixed-policy barrier waves
   before rebuilding the group/aggregate and retrying the adapter guard;
3. reject/omit according to S4 after passes are exhausted;
4. defer encoded bytes, media count, tools/stream combination, and full request
   body limits to materialization/final request validation.

A transport rejection never rolls back valid source/derivative Memory facts; it
only prevents noncompliant egress.

The state machine is therefore fixed-policy closure -> adapter guard -> guard
derivatives -> recognition/Memory -> fixed-policy closure on new occurrences ->
aggregate rebuild -> adapter guard. Existing lineage depth, per-policy run,
per-root artifact, and maximum transport-pass limits bound the cycle.

### 6.6 Adapter materialization and history

`dashscope-oss-v1` preserves the temporary upload flow. Authorization requires
the exact supported inference/upload scopes, allowed auth mode, credential
source and instance, verified TLS, and case-sensitive model. Its cache key
contains adapter/profile version, SHA-256, wire model, endpoint scope, and
credential-instance ID. An adapter handle is never identity.

The first model-capability entry is deliberately narrow and remains
candidate-only until its exact fake/real matrix passes. Its `providerId` is
exactly the built-in `alibabaStandard`; an arbitrary provider record pointing at
the same hostname is not equivalent:

| Field                  | `dashscope-oss-v1` / `qwen3.5-omni-plus` value                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| provider/protocol/auth | builtin `alibabaStandard` / `openai-chat` / static `AuthType.USE_OPENAI` only                                         |
| image                  | JPEG/PNG, `dashscope-oss`, user/split-user, `20_000_000` bytes; width/height `>10`; aspect ratio `<=200`; no duration |
| audio                  | WAV/MP3, `dashscope-oss`, user/split-user, `1_000_000_000` bytes, 3 hours                                             |
| video                  | MP4, `dashscope-oss`, user/split-user, `1_000_000_000` bytes, 1 hour                                                  |
| max media parts        | `8`                                                                                                                   |
| max encoded refs       | `131_072` UTF-8 bytes                                                                                                 |
| max serialized body    | `2_000_000` UTF-8 JSON bytes                                                                                          |
| tools                  | candidate-supported                                                                                                   |
| streaming              | `required`; false or absent is rejected before capture                                                                |
| tool choice            | `['absent']` until exact real evidence widens it                                                                      |
| upload/config clamp    | decimal `1_000_000_000`, returned `max_file_size_mb`, configured upload cap, and model cap; minimum wins              |

Formats or models not in this table—including WebP/GIF, FLAC/OGG/M4A,
MOV/WebM/AVI, `qwen-vl-max`, and `qwen3-omni-flash`—remain legacy even if older
tests or provider parsing recognize them. They need their own model-capability
entry and evidence. Qwen OAuth, missing/static-placeholder credentials, and all
other `AuthType` values are ineligible. The profile is enabled only after the
canonical-China image/audio/video plus tools/stream matrix passes; until then it
is disabled candidate code rather than an underspecified authority.

DashScope uses three operation-specific scopes rather than pretending one
fixed POST endpoint covers the protocol:

```ts
interface UploadPolicyScope {
  inferenceScopeId: string;
  method: 'GET';
  requestPath: '/api/v1/uploads';
  exactQuery: { action: 'getPolicy'; model: string };
  requiredHeaders: {
    authorization: 'downstream-bearer';
    contentType: 'application/json';
  };
}

interface IssuedUploadScope {
  issuerPolicyRequestId: string;
  modelId: string;
  credentialSourceOwnerId: string;
  credentialInstanceId: string;
  expiresAt: string;
  uploadUrl: string;
  bucketFromUploadHost: string;
  objectPrefix: string;
  issuedCredentialHandleId: string;
  requiredFormLiterals: {
    objectAcl: 'private';
    forbidOverwrite: 'true';
    successActionStatus: '200';
  };
  requiredFormFieldFingerprint: string;
}

interface IssuedUploadCredentialHandle {
  handleId: string;
  scopeId: string;
  expiresAt: string;
  policyBytes: 'secure-zeroizable-bytes';
  signatureBytes: 'secure-zeroizable-bytes';
  accessKeyIdBytes: 'secure-zeroizable-bytes';
}
```

The first candidate profile version defines one public scope. Its dynamic
getPolicy/OSS portion matches the
[official temporary-storage contract](https://help.aliyun.com/en/model-studio/get-temporary-file-url),
but that page's inference example is not evidence that
`qwen3.5-omni-plus` accepts this public compatible-mode endpoint:

| Field               | `dashscope-cn-beijing-public-v1` value                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| inference           | `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`                                                                |
| policy              | `GET https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=<exact-model>` with the same static key owner                  |
| issued upload host  | HTTPS port 443, no path/query/fragment/userinfo, bucket matching `^dashscope-[a-z0-9-]+$`, suffix exactly `.oss-cn-beijing.aliyuncs.com` |
| object key          | exact returned `upload_dir` plus one harness-generated sanitized filename; no empty/absolute/dot segment                                 |
| inference reference | returned object key under `oss://`, same exact model/key owner, resolve header required                                                  |

`upload_dir` is an object prefix, not the OSS bucket. The bucket is parsed from
the exact `upload_host`. The getPolicy validator requires exactly one
`Content-Type: application/json` plus the owned Authorization header; a missing,
wrong, duplicated, or custom-overridden value fails before network I/O. The
policy response is capped at `65_536` bytes and schema validated. It requires
`x_oss_object_acl` exactly `'private'` and `x_oss_forbid_overwrite` exactly
`'true'`; missing, duplicated, differently cased, public, or overwrite-enabled
values fail before any OSS request. The writer uses those typed literals plus
code-owned `success_action_status='200'`, never an unmodeled response string.
The three
numeric fields accept either a JSON safe positive integer or a string matching
`^[1-9][0-9]*$`; strings with sign, whitespace, exponent, fraction, leading
zero, excessive length, or values above `Number.MAX_SAFE_INTEGER` are rejected.
`expire_in_seconds` is clamped by the code-owned 48-hour handle lifetime.
`max_file_size_mb` is overflow-checked as decimal `value * 1_000_000` bytes and
only narrows the `1_000_000_000` adapter/model/config cap.
`capacity_limit_mb` is validated with the same canonical integer rule and
treated as an account quota, never misread as remaining per-file capacity.
The resulting issued scope binds expiry, model, owner, bucket, object prefix,
one object key, typed form literals, an opaque issued-credential handle ID, a
fingerprint over the complete upload authority/key/required form contract, and
one upload URL. The handle is an unforgeable operation-owned in-memory
record; each field is nonempty, individually capped at `65_536` bytes, the two
live scopes together are capped at `262_144` bytes, and the bytes are zeroized
on validated success, ambiguous dispatch, expiry, cancellation, or operation
end. Multipart construction resolves it just in time and revalidates scope,
owner, expiry, and fingerprint. Raw values never enter the scope, cache, Memory,
logs, or diagnostics. Multipart
validation checks required field order/names, exact secure credential values and
typed literals, immutable file hash/size/MIME, and absence of the
downstream Bearer header; `file` remains the final form part.

Retries follow operation semantics, not a generic POST policy. The authenticated
upload operation freezes one code-owned budget before its first request:
`maxGetPolicyAttempts: 3`, `maxIssuedUploadScopes: 2`,
`maxOssPostAttempts: 3`, and an absolute monotonic deadline of `1_800_000` ms.
Every policy request, newly issued scope/key, and physical OSS POST atomically
consumes that shared budget; cancellation, deadline, or exhaustion ends the
operation with no cache publication. The authenticated getPolicy GET may retry
with the same frozen context only inside this budget. An issued OSS POST that
fails before dispatching any body byte may retry the same scope/key. Once any
body byte has been dispatched without a definitive validated success response,
that key is permanently ambiguous: it is never retried, resolved, or published
to the delivery cache. The adapter rechecks trust/config/owner, obtains a fresh
policy, generates a fresh sanitized object key and `IssuedUploadScope`, and
restarts from offset zero on the same pinned snapshot. A possible prior object
is an unreachable provider-side orphan that expires with temporary storage; the
harness never claims it. A policy-expired `403` received before body dispatch
also restarts from fresh policy. Exact validated success means no redirect,
status exactly `200`, and an exactly zero-byte response body. A `200` with even
one chunked byte, `201`, `204`, or any other status is failure; after body
dispatch it is ambiguous and never publishes or reuses the key. A fresh policy
does not reset counters or the deadline. This exact
success is the only event that publishes an `oss://` cache entry.

Issued credentials use a separate operation taint matcher, not the conversation
provider-credential vault or its 64-instance limit. The successful getPolicy
body is private operation input: the schema parser accepts credential bytes only
at the three exact definition fields. A bounded byte-oriented JSON decoder
unescapes those values directly into secure mutable buffers and never creates an
immutable JavaScript credential string. It moves the buffers into the secure
handle, scans every other field and all response headers for duplicate echoes,
and then zeroizes the raw body before any log, diagnostic, or caller release. From that
point through destruction, the matcher scans every bounded OSS response header/
body, SDK/fetch error, log, and diagnostic for policy/signature/access-key bytes
across chunk/encoding boundaries. A getPolicy error body is scanned in full and
never treated as a definition source. Destroying a handle zeroizes request
material, parser buffers, and matcher state; any unauthorized echo produces only
a constant error and no cache publication.

Issued handles and their matcher use the same last-holder rule as the
conversation vault: each getPolicy parse/OSS request owns an operation lease;
success, ambiguity, cancellation, expiry, or operation end closes the scope and
aborts holders, but zeroization waits until the last parser/validator holder
releases. A closed holder may only finish scan-and-discard or fail closed.

The current provider detector also recognizes international, US, workspace,
Token Plan, internal, subdomain, and proxy routes, but detector compatibility is
not upload authority. They have no `dashscope-oss-v1` scope in the first
profile and keep their pre-managed compatibility path. A later scope must be a
maintainer-owned code or deployment registry entry with exact inference/policy
origins, OSS bucket/region relation, auth/credential source and instance, TLS
policy, and fake plus real evidence; ordinary user provider settings cannot
create it. An arbitrary
DashScope-compatible hostname or trusted base URL is never authority.

Current Qwen-Omni documentation publishes workspace-ID inference endpoints,
whereas this first candidate intentionally names the built-in public
`alibabaStandard` route. Therefore the public scope remains disabled unless a
credential-gated real matrix proves this exact model, endpoint, mandatory
streaming, and upload/reference tuple. Failure of that matrix removes the
candidate rather than substituting the temporary-upload page as inference
evidence. A future workspace scope requires a maintainer-owned provider identity
and typed exact workspace-host/policy/OSS-region/key-owner relation; a
user-entered workspace hostname cannot authorize it.

The official temporary-upload service is documented for development and test
use. Consequently `dashscope-oss-v1` remains an experimental/dev-test adapter
even after its candidate matrix passes; enabling it only opens the existing
`omni.enabled` experiment and is not production graduation. A production Qwen
adapter requires a separate maintainer-owned profile and review of its supported
storage API, lifecycle/SLA, capacity, retry/idempotency, credential, and data-
retention contract. Evidence for this temporary adapter cannot be reused as that
approval.

`minimax-openai-inline-v1` reads the verified managed object and uses the
existing OpenAI converter only for profile-approved `image_url`/`video_url`
data. It performs no upload and no persistent inline cache. Tool-result splitting
moves the complete delivery group to an approved user placement.

New persistent groups are re-materialized on every provider/model/credential
switch. DashScope -> MiniMax -> DashScope therefore produces new scoped wire
representations for the same version. A missing object or unsupported modality
becomes an adjacent unavailable/unsupported placeholder.

Legacy wire history is never forwarded as an owned reference. Within an already
managed conversation, a legacy inline image/audio/video slot produced by an
earlier per-turn compatibility fallback is decoded under current budgets,
captured with a versioned `legacy-history` occurrence locator, and converted to
a managed group; failure becomes unavailable. This is not transcript migration:
an existing legacy conversation remains legacy. An unowned `oss://`, remote file
ID, or inaccessible URL cannot be reconstructed and becomes unavailable.

Disabling the MiniMax profile is a safe media-adapter rollback: native/derived
MiniMax media follows the old path, while a separately authorized statically
complete text/omission processor route may still run. Complete zero-effect
rollback uses `omni.enabled=false`. This does not claim byte-for-byte pre-change
replay for managed history; such history is shown as unavailable while the
profile is disabled and becomes usable again after re-enable.

### 6.7 Final validation at the real SDK boundary

The current OpenAI SDK constructs URL, headers, auth, serialization, and retries
inside the client, so validation does not invent a pre-SDK serialized envelope.
Every `openai-managed-v1` request receives a base `ProviderRequestContext` that
validates URL/method/model/auth owner/config epoch/credential taint; media
profile and manifest checks are an optional second layer. Thus an audio policy
that leaves only transcript text for a verified OpenAI-compatible route still
receives final-request validation; Anthropic/Gemini are not admitted in this
slice.

The base context freezes a `64_000_000`-byte serialized request-body cap only for
`buffered-json-v1` inference and processor requests. A
`verified-multipart-v1` request instead proves an overflow-safe exact
`Content-Length` no greater than code-owned framing plus the minimum of the
adapter, model, user-configured, and issued-policy file caps; it may therefore
carry a decimal `1_000_000_000`-byte file. Response limits are independent:
`8_000_000` transfer-decoded payload bytes, `8_065_536` complete HTTP/1 response-
message bytes, and `8_000_000` decoded identity-body bytes for managed
inference. The message allowance is the payload cap plus a fixed `65_536` bytes
for status line, headers, chunk-size lines/extensions, CRLF delimiters, and
trailers; exceeding it is fatal even when payload remains below its cap. The
profile also permits `1_000_000` bytes per SSE line, `2_000_000` bytes
per SSE event, `4_000_000` aggregate UTF-8 semantic-string
bytes, at most `4_096` data events and `64` tool calls, and `65_536` bytes for a
non-success body. The exact response schema has one choice and rejects unknown
unbounded collections before the SDK sees them.
Operation-specific profiles may only narrow them (the ASR, getPolicy, and issued
OSS limits above do), and every response profile specifies transfer-decoded
payload, complete-message, and decoded-body caps. Its complete-message cap is
always the checked sum of its payload cap and the same fixed envelope allowance.
The final immutable SDK request bytes—including a transcript-only
request with no media profile and all harness-owned extra fields—are checked
before allocation/copy when their length is known and again on the frozen bytes;
cap plus one is never parsed or dispatched.

`openai-managed-v1` does not expose a provider body to the SDK incrementally.
Every physical attempt owns a dedicated HTTP/1.1 connection; it cannot reuse or
pipeline a socket and closes it after this response. A maintained Undici patch
checked-adds each raw post-TLS socket buffer to `transportMessageBytes` before
llhttp sees it. That count includes status/header bytes, chunk-size lines and
extensions, CRLF framing, trailers, and payload. It drives the body-idle timer
and is bounded by the operation's complete-message cap. Because the connection
contains exactly one response, no following response can be charged to the
wrong attempt. Separately, the sealed handler checked-adds every transfer-
decoded `onData` chunk to the operation's payload cap before forwarding it.
Either cap plus one destroys the socket and dedicated dispatcher and releases
response/matcher/operation leases before SDK, retry, or cache publication.
`Content-Length` is only an early rejection; chunked/no-length responses remain
subject to both counters. The request-local fetch separately
rejects an over-limit decoded length, consumes the entire decoded body into a
private bounded buffer, and validates it before constructing the `Response`
returned to the SDK. For a streaming wire response, a code-owned
fatal UTF-8/SSE decoder enforces raw/line/event caps, complete event framing,
canonical JSON, and the exact profile response schema. It recognizes `[DONE]`,
standard `{error:...}`, `event:error`, `error_finish`, malformed JSON, invalid
UTF-8, and 200 non-SSE bodies itself; every invalid/error form discards buffered
provider content and throws one constant operation/status error. A versioned
`OpenAIResponseProfile` also owns content type, caps, complete JSON/SSE schema,
semantic-error predicates, finish enum, and endpoint-level automaton. Its ID and
version are frozen in `ResolvedProviderRoute` or `ResolvedProcessorContext`,
participate in candidate/exact proof and config epoch, and are revalidated at
final fetch. Settings cannot define or select a parser. First-slice profiles are:

- `minimax-chat-v1`: stream or non-stream; serialized request `n` must be absent;
  every response/event has exactly one choice with `index:0`; it requires one
  terminal data event whose choice has a verified nonempty `finish_reason`;
  an optional top-level `base_resp`, wherever the exact schema permits it, must
  contain safe-integer `status_code:0`. Nonzero, missing/non-integer status code,
  or malformed `base_resp` is a constant semantic error, and `status_msg` is
  never logged/displayed. Before the terminal no
  tool call may execute, and EOF or `[DONE]` is invalid. After it, only one
  schema-valid usage-only trailer and then an optional `[DONE]` may occur; any
  other data, duplicate terminal, or bytes after `[DONE]` fail the entire body.
  EOF after the terminal (and optional usage trailer/`[DONE]`) is valid, so the
  profile does not invent a provider requirement that `[DONE]` be present. The
  allowed finish-reason enum is frozen from the exact endpoint contract and fake/
  real evidence before that endpoint scope is verified;
- `dashscope-qwen-omni-v1`: streaming is required; exactly one index-0 choice,
  one verified terminal finish event, at most one usage-only trailer, and a
  mandatory final `[DONE]` followed only by EOF. Its exact Qwen semantic-error
  fields and finish enum are frozen by the disabled-candidate real-evidence gate;
- `dashscope-qwen-omni-asr-v1`: used only by the built-in ASR request profile;
  streaming is required, exactly one index-0 choice, one terminal finish event
  and mandatory final `[DONE]`. The first delta may contain exactly
  `role:'assistant'`; later role is null or absent. Schema-defined
  `function_call`, `refusal`, and `tool_calls` are accepted only when null, and
  choice-level `logprobs` is accepted only when null or absent. The
  code-owned bounded top-level request/model/usage metadata follows the exact
  fixture. Only string `delta.content` accumulates transcript. Non-null tools,
  wrong/repeated role, reasoning, audio output, unknown extensions, and
  post-DONE bytes are rejected even when the inference profile would accept a
  tool-bearing event;
- `standard-openai-stream-v1`: used only for operator-explicit ASR, streaming is
  required and follows the same role/null/content-only semantic accumulation
  grammar, including null/absent choice-level `logprobs`, one terminal finish
  event and mandatory final `[DONE]`; tools,
  reasoning, audio output, unknown provider extensions, and post-DONE bytes are
  rejected. A custom endpoint that does not conform stays legacy/unavailable.

Cross-profile fixtures prove that a terminal sequence accepted by one profile is
not silently accepted by another. Non-streaming
JSON receives the same complete schema validation. Non-success and issued-OSS
responses use the smaller error cap and are never read with unbounded
`response.text()`. Only a completely validated immutable body is returned to the
SDK, so SDK parsing cannot log or release a partial provider event. The wire may
still require `stream:true`, but first-slice managed UI delivery is deliberately
delayed until response validation completes; low-latency streaming is a later
adapter version, not a hidden relaxation.

Credential taint is a base decoded-response concern. Each conversation holds an
in-memory `ConversationCredentialTaintVault` containing secure, zeroizable
matcher material for the exact bytes of every managed credential used during
that conversation, including rotated-out instances; only IDs persist, and all
matcher bytes are destroyed at conversation disposal. The vault admits at most
`64` distinct instances and `1_048_576` aggregate matcher bytes; reaching either
limit makes further managed provider switching unavailable for that conversation
rather than evicting an old matcher. Response headers and raw
bytes are scanned, then every decoded semantic string is accumulated and scanned
per channel—assistant text, reasoning, tool name/arguments, audio/text fields,
and provider metadata—across JSON escapes and SSE event boundaries for both the
secret and `Bearer <secret>`. The complete decoded turn is scanned again before
the validated body reaches the SDK, tool execution, UI/log/telemetry,
conversation persistence, or another provider. Any match discards the whole
body and produces only a constant error. After process restart, persisted history
is already taint-free; raw credential matcher material is never written to disk.

Every physical managed request obtains an unforgeable matcher lease before
dispatch and retains it through complete semantic scan or fail-closed abort.
Conversation disposal atomically marks the vault closed, rejects new leases, and
aborts all holders, but does not zeroize matcher bytes while a callback/decoder
may still observe late headers/body. A closed holder can only finish scanning and
discard or fail closed; it releases nothing to SDK/UI/log/persistence. The last
lease release zeroizes all matcher bytes and resolves an internal disposal
completion promise; synchronous ACP `dispose()` may return after starting this
sequence, but resource destruction completes only at that promise. No new turn
can reuse the closed conversation.

Before any managed object read, base64/data-URL allocation, or SDK call, every
buffered JSON plan acquires a process-wide `RequestMaterializationBudget` from
its source metadata and code-owned JSON layout. The cap is `512_000_000` memory
bytes with at most `32` bounded waiters. Checked reservation is
`decodedSourceBytes + 6 * predictedSerializedUtf8Bytes`; a value above the cap or
the route's 64-MB body limit fails before opening the pinned object. The writer
uses an allocation-counting serializer, verifies exact base64 and JSON UTF-8
length while constructing them, and the fetch boundary rechecks the same frozen
bytes. The reservation covers source buffers, data-URL UTF-16 strings, SDK JSON,
immutable request bytes, and remains until request-body consumption plus the
outer attempt finishes/aborts; every early error releases it. Text-only plans
reserve from the bounded request AST before `JSON.stringify`. Multipart does not
charge its 1-GB disk fd as memory; it has a separate code-owned concurrency-two
semaphore and reserves `16_000_000` bytes per writer for framing/stream state.
Thus waiting happens before media materialization or SDK serialization, never
inside injected fetch while large bodies are resident.

Every buffered physical response participates in a separate process-wide
`ResponseAdmissionBudget` before dispatch. The code-owned process cap is
`256_000_000` memory bytes with at most `64` waiting attempts. One attempt
reserves, with checked arithmetic, sixteen times the greater of its complete-
message and decoded response caps to cover transport chunks, the decoded buffer, semantic
accumulation, immutable `Response`, and SDK parser lifetime; capacity shortage
queues before network I/O or returns a constant
unavailable result when the waiter bound is full. The reservation is retained
until SDK consumption and the outer attempt both finish or abort, then released
on every validator/error/cancel path. Content-Length rejection and incremental
no-length growth consume the same reservation. Operation-specific small
responses reserve sixteen times their smaller cap; any computed reservation
above the process cap makes that route unavailable before dispatch.

For each call, a code-owned factory constructs a fresh immutable
`ManagedOpenAIClient` subclass from only the validated base URL, model route,
credential handle, and owned request-local options. It does not call
`sharedClient.withOptions()`, because OpenAI SDK 5.11 inherits the shared
`fetchOptions`/dispatcher through that API. The constructor explicitly sets
`fetch: requestLocalFetch`, `fetchOptions: undefined`, `maxRetries: 0`,
`timeout: 0`, `logLevel:'off'`, `logger:NOOP_MANAGED_LOGGER`, and null
organization/project/webhook identity, and rejects any inherited `_options` or
caller transport field before request construction. A contract test starts with
a legacy base client containing the normal shared dispatcher and proves neither
that dispatcher nor SDK timeout reaches `requestLocalFetch`; the only physical
dispatcher is the newly created exclusive Agent below. Proxy, no-proxy, and
TLS-insecure legacy clients cannot donate transport state. The factory never
mutates the shared client or uses global/async-local manifest state. Managed
OpenAI SDK `5.11.0` accepts zero as an integer timeout and omits its timeout
header; the subclass overrides the public `fetchWithTimeout` method so the SDK
does not install an absolute timer around the request-local fetch. A pinned-SDK
contract test fails an upgrade if either behavior changes. `requestLocalFetch`
instead owns two abort-linked deadlines: the configured request timeout covers
DNS/connect until response headers, and the configured stream inactivity timeout
is reset only by each pre-parser raw socket buffer for streaming and non-
streaming responses. Transfer-decoded `onData` is not claimed to observe HTTP
framing and cannot replace that transport-progress counter.
It also owns an unconfigurable monotonic `1_800_000` ms absolute operation
deadline from pre-dispatch admission through full validated body consumption.
Continuous progress may exceed the header timeout but never this hard deadline;
silence at the idle deadline or reaching the absolute deadline cancels the
reader/socket and returns a constant error. An explicitly disabled idle timeout
removes only that body-idle timer; the absolute deadline, header timeout,
complete-message, transfer-decoded payload, decoded-body caps,
ResponseAdmissionBudget, and user abort remain.

Managed
inference and processor POSTs have no provider idempotency contract, so they are
never retried automatically after either a pre-dispatch or ambiguous
post-dispatch failure. The authenticated getPolicy GET retains its bounded
operation-specific retry, while issued OSS POST retry follows Section 6.6.
The immutable `ManagedRequestAttemptPolicy { maxAttempts: 1 }` is threaded
through `client.generateContent`, `BaseLlmClient`, side-query/Vision Bridge, and
every `retryWithBackoff` caller; each must prove the value before invoking the
content generator. SDK retry, outer API retry, streaming restart, invalid-stream
retry, and model fallback cannot create a second managed POST after any failure.
GetPolicy/OSS operations do not pass through this generic wrapper. Future POST
retry requires a versioned provider idempotency contract. Two
concurrent calls therefore cannot exchange contexts. On every physical attempt
the wrapper separates wire fields from a closed transport-only allowlist. For
the current bundled Undici path, only the code-owned direct dispatcher may
survive; arbitrary caller transport fields are rejected.
Dispatcher identity and its sealed direct TLS-verification descriptor must match
the runtime context resolved for this request. A proxy/custom/insecure or
uninspectable dispatcher fails before capture/I/O, so `NO_PROXY`, CONNECT, and
proxy credentials are not part of the first managed wire contract. The direct
branch is a code-owned single-attempt Undici `Agent` with one connection and
`pipelining:1`; it is destroyed after the validated response or any abort and is
never shared by retries or concurrent calls. Its descriptor fixes
`connectTimeout:0`, `headersTimeout:0`, `bodyTimeout:0`,
`maxHeaderSize:32_768`, and `connect.rejectUnauthorized:true`. Zero disables the
three internal timers in the pinned Undici API; `RequestInit.timeout` is not used
because fetch ignores it. The adapter AbortSignal is therefore the only connect/
header/body deadline owner. Source localization uses the same timer/header
contract while supplying only its DNS-pinned lookup function. Startup flags such
as `--max-http-header-size` cannot widen the explicit Agent cap.

The managed build pins Undici `7.28.0` plus one integrity-checked maintained
patch to its HTTP/1 transport/parser. At the raw socket-data entry before llhttp,
the patch checked-adds the entire post-TLS buffer to the attempt's complete-
message count before parsing any byte, resets the inactivity timer, and destroys
the dedicated connection at cap plus one. After response completion, any further
socket byte is an error; the connection is never returned to a pool. Before
converting status chunks to strings,
`onStatus` checked-adds every chunk to both the response's `headersSize` and a
separate `statusTextSize`; the former remains bounded by `32_768` and the latter
by `1_024` bytes. Exceeding either destroys the socket immediately. Both counters
reset only at the same parser boundary as the rest of that response header
block. The patch appends the bounded chunks so the wrapper receives the exact
reason phrase, scans it with the response credential matcher, then forwards an
empty `statusText` to Fetch/SDK. Its source patch digest, resolved Undici version,
and parser contract fixture participate in physical-profile eligibility; an
unpatched or upgraded parser disables all managed physical routes. Thus reason-
phrase bytes cannot bypass `maxHeaderSize` before `onHeaders`.

The sealed direct dispatcher wraps the physical response handler below Fetch.
Pinned Undici rejects status `100` in `onHeadersComplete` before calling the
request handler; the wrapper's `onError` maps that parser-specific path to the
same constant error, aborts the socket, releases response/matcher/operation
leases, and forbids retry. For other reachable informational statuses, wrapper
`onHeaders` observes the complete bounded block before Fetch discards it and
rejects it identically. Status `101`/upgrade is unavailable for every managed
operation and follows its pinned parser/onUpgrade rejection contract. No path
waits for or exposes a later final response. The rule applies to inference,
processor, getPolicy, issued OSS POST, and source localization. Therefore neither
a large reason phrase nor a sequence of `103` blocks bypasses the raw response
budget. Supporting informational responses in the future requires a versioned
operation profile with explicit count and cumulative raw-header limits.

Every source-localization and managed provider/processor/upload request runs in
a code-owned `SensitiveEgressScope`. Qwen's pinned Undici instrumentation checks
that request-local scope in its `ignoreRequestHook` before creating a span or
injecting trace headers. It records neither `url.full`, `url.path`, `url.query`
nor a propagation header for the physical request; separately emitted harness
metrics use only the allowlist in Section 10. Instrumentation package version,
hook/config identity, and `outboundCorrelation` state participate in profile
eligibility, and failure to prove suppression makes the route unavailable before
capture. Arbitrary process-injected diagnostics subscribers/preloads are trusted
operator code in the same process TCB; the design does not falsely sandbox them.

The managed per-call client ignores `OPENAI_LOG`, shared-client logger settings,
and caller logger overrides. SDK request options/body, response/body, and parse
errors therefore cannot be logged before the final fetch/parser boundary.
Qwen Code's outer `reportError`, retry telemetry, console, and debug-file paths
receive only code-owned operation/status/reason IDs for a managed attempt, never
request contents, media, tool arguments, provider payloads, endpoints, or
credentials. Tests install hostile environment/custom loggers and capture all
console/logger sinks on validator success and failure.

The owned constructor accepts an incoming redirect mode only when it is absent
or already `error`, and explicitly creates the unique snapshot with
`redirect:'error'`. `follow` or `manual` is rejected before I/O. Inference,
processors, getPolicy, and issued uploads all use this constructor, so 301, 302,
307, and 308 never create a second request carrying a key, temporary form
credential, or media body.
Source localization uses a separate owned constructor that accepts only
`redirect:'manual'`; it never enters this provider/upload constructor.

Body validation has two bounded strategies:

- `buffered-json-v1`: the wrapper freezes the exact SDK-provided string/
  ArrayBuffer/typed-array bytes under the operation's hard body cap, validates a
  read-only copy of those bytes, and constructs the Request from that same
  immutable buffer. It never reserializes a parsed object.
- `verified-multipart-v1`: DashScope no longer delegates boundary/body creation
  to `FormData`. A code-owned writer freezes one boundary, ordered field byte
  strings, exact Content-Length, and the `openPinnedMediaTarget` fd in a
  branded transfer descriptor. The operation validator proves the descriptor,
  headers, issued values, hash/size/MIME, and file-last order before constructing
  one streaming Request. It sends that stream once without cloning or teeing
  the body. The constructor supplies the code-owned `duplex:'half'` required by
  Node for that branded stream; an unbranded stream is rejected.

The original snapshot is passed as
`underlyingFetch(snapshot, approvedTransportOnlyInit)` inside that sensitive
scope. The second init cannot
contain method, URL, headers, body, signal, redirect, credentials, or any field
that changes wire semantics. It carries only the validated direct Agent; the
obsolete `timeout:false` field is forbidden. This freezes mutable headers/bytes
and one multipart boundary while retaining the exact no-internal-timer contract.
A near-1-GiB upload therefore has bounded RSS and starts
streaming without queueing a complete unread tee branch. Each permitted
operation-specific retry builds and validates a fresh snapshot/descriptor and a
new positional reader starting at offset zero on the same pinned immutable fd;
adapter-owned deadlines, direct transport, telemetry suppression, and bounded
response parsing remain in place.

The adapter distinguishes snapshot-owned headers from physical-transport
headers synthesized after `fetch`. `openai-managed-v1` pins exact Node/Undici
and HTTP protocol versions and registers a versioned
`UndiciPhysicalHeaderProfile`. For direct HTTP/1.1 it derives Host and
Content-Length from the already validated URL/body and permits only the pinned
runtime values/grammars for `Accept-Language: *` and
`Sec-Fetch-Mode: cors`. The owned Request constructor explicitly sets the single
values `Connection: close` and `Accept-Encoding: identity`; caller override,
duplicate value, omission after
construction, or any response `Content-Encoding` other than absent/exact
`identity` fails before body forwarding. Compression is not part of the first
managed physical profile. The patched socket-message and transfer-decoded
`onData` caps remain independent, so chunk framing, trailers, runtime bugs, and
identity streams cannot bypass either budget.
Every
other physical header, including `traceparent`, is forbidden. Proxy/CONNECT and
HTTP/2 have no first-slice profile. A runtime/version/instrumentation mismatch is
unavailable until it has its own profile. Raw TLS server contract tests record
actual wire headers; an SDK, Node, Undici, instrumentation, or protocol upgrade
that adds or changes one disables managed egress rather than widening the
allowlist. Thus the immutable snapshot, sensitive-egress suppression, and sealed
direct transport profile together—not the snapshot alone—prove the physical
request.

The request-local manifest makes media structure explicit:

```ts
interface MaterializedMediaManifestEntry {
  deliveryItemId: string;
  jsonPointer: string;
  modality: MediaModality;
  mimeType: string;
  referenceKind: AdapterReferenceKind;
  decodedSha256: string;
  decodedBytes: number;
  encodedUtf8Bytes: number;
  messagePlacement: MediaPlacement;
}
```

The base fetch validator first checks common current trust/config epoch, direct
TLS/dispatcher identity, method class, no userinfo or fragment, and the exact
discriminated physical-operation arm. Redirect mode is deliberately not common.
The validator never
models query or Authorization as nullable common fields:

- `inference | processor`: exact code-owned HTTPS origin/path, query absent,
  `redirect:'error'`,
  case-sensitive serialized model, and exactly one downstream Bearer whose
  credential instance/owner matches the frozen context;
- `getPolicy`: exact HTTPS origin/path and exactly the canonical
  `action=getPolicy&model=<exact-model>` query, `redirect:'error'`, plus exactly
  one matching downstream Bearer;
- `issuedOss`: exact issued HTTPS origin/path/query from the validated policy,
  `redirect:'error'`, downstream Authorization absent, and the three zeroizable
  issued credential handles present only in their exact multipart fields;
- `sourceLocalization`: the exact current HTTPS URL and bounded canonical query
  authorized by the DNS-pinned localization context, exact method `GET`, body
  absent, and `redirect:'manual'`, with
  Authorization, Cookie, issued form credentials, and `Proxy-Authorization` all
  absent. The owned constructor rejects every caller method/body rather than
  relying on Fetch defaults. A content response succeeds only at exact status
  `200`; `201/202/204/206` and every other status are constant failures, so a
  partial response can never become a complete CAS object. Only exact
  `301 | 302 | 303 | 307 | 308` with one bounded valid `Location` may enter the
  redirect state machine; all other 3xx fail. Before the next hop it performs
  SSRF, DNS pin, trust/config, TLS, query/header, method/body, and fresh
  operation-arm validation and constructs a new dedicated Agent/Request. A
  redirect never reuses provider endpoint authority.

Each arm has a closed operation-owned header list. Inference/processor allow
only Authorization, Content-Type, Accept, User-Agent, the code-owned
`Accept-Encoding: identity` and `Connection: close`, and the pinned SDK's
enumerated `x-stainless-*` identity headers; getPolicy, issued OSS, and source
localization use their own narrower lists plus those same two mandatory
transport values. Every non-Authorization allowed header also has an exact
code-owned/SDK-versioned value or value grammar and trusted provenance; caller/
default/custom overrides are rejected even when the name is allowed. Unknown
caller/custom headers are rejected. `OpenAI-Organization`, `OpenAI-Project`,
Cookie, caller `Proxy-Authorization`, and every other OpenAI/caller identity
header are always forbidden; `customHeaders` cannot replace Authorization,
Host, or required headers. Cross-arm validation rejects a Bearer in OSS/source,
an issued form handle in inference/getPolicy, or a source query reinterpreted as
a provider endpoint query;

- known credential taint is absent from non-authorization structured fields.
- reserved request fields were produced by the harness, the actual serialized
  tools/stream/tool-choice mode equals the frozen context. Provider inference
  with neither media profile nor processor request profile has zero
  schema-defined image/audio/video slots; processor chunks instead match their
  exact request profile and manifest entry.

When a media profile is present, the media validator additionally checks:

- the exact profile/version and endpoint-scope verification state;
- every schema-defined structured image/audio/video reference has exactly one
  manifest entry and every entry points back to exactly one such JSON Pointer;
- decoded hash/bytes, encoded data/reference bytes, MIME, reference kind,
  recognized image dimensions/aspect ratio, placement, media count,
  tools/stream/tool-choice combination, and final serialized UTF-8 body bytes
  satisfy the profile; the validator derives streaming and `toolChoiceMode`
  independently from the final request rather than trusting the planner;
- DashScope's resolve header exists iff an owned `oss://` entry exists; MiniMax
  has no `oss://`, foreign handle, or DashScope header;

Ordinary text is not scanned for URL/path/scheme substrings. A user can discuss
`https://`, `/Users/...`, or `oss://` normally. URL/path/reference validation is
limited to schema-defined media slots and manifest provenance. PDF remains under
the old converter contract; global header/credential ownership still applies,
but this design does not reinterpret PDF strings as managed image/audio/video.

DashScope getPolicy, issued multipart upload, and external policy processors use
their operation-specific validators but the same unique-Request-snapshot rule.
Every permitted operation-specific retry repeats authorization; no secondary
origin receives a downstream model credential. Managed inference and processor
POSTs have no such retry.

## 7. Storage, Memory, and lifecycle

Copying local input into CAS intentionally supersedes the old rule that local
user bytes stay in place. The logical File still represents its occurrence, but
each successfully managed version uses immutable backing while live.

Before non-DashScope rollout, complete the governance proposed by the earlier
storage design. The authoritative S5 baseline already has
`omni.storage.quarantine`; it does not yet have the project object/transient
budget, object retention, or partial-file retention fields. This slice preserves
the existing quarantine fields and adds the exact missing schema:

```jsonc
{
  "omni": {
    "storage": {
      "retentionDays": 14,
      "maxTotalBytes": 21474836480,
      "partRetentionHours": 48,
      "quarantine": { "retentionDays": 7, "maxBytes": 5368709120 },
    },
  },
}
```

The three new fields are decimal JSON numbers that must satisfy
`Number.isSafeInteger` and these code-owned ranges:
`retentionDays: 1..3650`, `partRetentionHours: 1..8760`, and
`maxTotalBytes: 10_000_000_000..1_125_899_906_842_624` (1 PiB). In addition,
`maxTotalBytes` must be at least ten times the configured DashScope single-file
ceiling; this also leaves room for the first object's immutable transfer
snapshot. All duration-to-millisecond conversions and timestamp additions are
checked against the supported Date range. Capacity arithmetic uses nonnegative
`bigint` totals and compares before conversion, so
`used + reserved + requested` cannot lose precision or overflow. Absent fields
receive the values above. Exponent notation that parses outside the safe integer
and any invalid explicit value fail managed-mode configuration before capture
and never silently fall back to another managed route. Existing
quarantine normalization keeps its current positive-value/default fallback
behavior; this proposal does not turn an old quarantine setting into a startup
failure. `partRetentionHours` applies only to expired, unleased partial files;
a valid owner lease always wins. Quarantine is outside the project's
`maxTotalBytes` object budget and obeys its separate project cap, but its bytes
and entries remain inside the broker's 50-GB aggregate physical pool. Transfer,
sweep, unlink failure, and crash preserve one exact aggregate owner until
physical reconciliation. These physical lifecycle knobs do not change
recognition/policy semantics and therefore do not enter the S5 computation
fingerprint; their normalized values do enter the project storage-service
config epoch used by reservations and GC.
`maxTotalBytes` governs object/transient media plus managed transcript,
fork-transcript, and file-history content bytes. Authority, sidecar, cache,
lease, bootstrap, journal, and directory-entry charges use the separate fixed
control-metadata cap and maintenance reserve in Section 5.3; neither pool may
borrow from the other.

The normalized storage settings and epoch are authoritative project state in
`memory-v2.json`, not per-process opinions. Every project-service lease records
that epoch, even while it owns no media object. Startup/config reload compares
under the project lock. A different normalized configuration cannot reserve,
capture, or sweep while any valid old-epoch service lease, transaction, or
reservation exists. The changing process first quiesces its managed service;
after all old owners drain, one transaction installs the new settings/epoch and
all subsequent operations revalidate it. A conflict fails managed mode with a
diagnostic rather than choosing last-writer-wins, a larger cap, or a shorter
retention policy.

The storage service then enforces this cross-process protocol:

- one v2 advisory lock domain serializes Memory-v2/import/write, locator-index
  and storage-catalog mutation, v2 CAS promotion/dedup, persisted-group root
  changes, and GC mark/sweep; GC obtains exclusive ownership and rereads all v2
  state. V1 uses a disjoint namespace and cannot enter or damage this domain;
- each in-flight request and active session publishes an atomic
  boot-ID/process-start-token/owner-nonce/TTL lease with heartbeat and
  managed-object roots plus staging/download/transfer-snapshot identifiers;
  recovery under the lock skips every valid lease-owned temporary. It removes a
  lease only when expired and that exact owner is no longer alive, preventing
  PID reuse or a suspended live process from being treated as dead;
- persisted conversation branch sidecars, active leases, and in-flight
  transactions/reservations are byte roots. A FileVersion or binary policy entry
  by itself is not a permanent byte root; reuse resolves its object binding and
  applies the generation/rehydration protocol when state is `missing`;
- sweep is a recoverable state machine under that same lock. After rechecking
  roots/retention, one v2 transaction changes `managed` to
  `deleting(deleteNonce)`. Readers cannot newly pin that state. GC atomically
  renames the CAS file on the same filesystem into a private `.gc/<nonce>`
  tomb and fsyncs the directory. The transaction that commits `missing` also
  creates a `GcTombRecord { deleteNonce, managedObjectId, sizeBytes }`; deleting
  objects and every live tomb record remain charged to physical project capacity.
  Only successful unlink plus directory fsync removes that record and releases
  its byte charge. Startup, and every admission path before granting a new
  reservation, reconciles tombs first: file-at-object-path means finish the
  rename; file-at-tomb means commit/retain the tomb record and retry unlink; a
  committed `missing` tomb remains charged across EBUSY/EACCES and continuous
  operation. If a live tomb record exists while both object and tomb paths are
  absent, recovery fsyncs both parent directories, then removes that tomb row
  and releases its charge exactly once in one transaction. If a `deleting`
  record has neither path, recovery performs the same directory fsync first,
  atomically commits `missing`, clears any tomb/charge, and records only a
  sanitized diagnostic; it never guesses that bytes remain. A missing file in `managed` is corruption and is reconciled to
  `missing` with a diagnostic; an unreferenced object file with no catalog row
  follows orphan retention. Every crash boundary leaks at most a charged,
  recoverable tomb and never presents deleted bytes as backed;
- binary recall/replay calls `openPinnedMediaTarget` before binding/disclosing
  a `resourceId`. Lease/snapshot failure makes that artifact unavailable; it
  never issues an immediately stale capability. After the result is released,
  it also publishes best-effort `lastUsedAt` keyed by object ID to the separate
  storage liveness journal. Recall never
  waits for that journal write and journal failure never changes hit/miss. Once
  no conversation/session/in-flight reference exists and the journal's last-use
  retention window passes, an object may be swept while S5 metadata/lineage
  remain and the object record becomes `missing`; text/metadata recall still
  works and explicit source re-reference may restore backing;
- sidecar-before-turn-pointer and turn-before-sidecar-delete ordering makes a
  crash leak a temporary root rather than delete live bytes; create/update
  failure uses the session-only fallback, delete failure is retried, and orphan/
  corrupt sidecars are cleaned or quarantined after retention under the lock.
  Rewind retains every persisted node that can still seed a branch. A registered
  project releases them only by committed branch/conversation tombstone; broker
  retirement of an unregistered project first marks all refs unavailable and
  removes the roots in the same project transaction;
- duplicate SHA consumes one object while Files/provenance stay separate;
- staging is removed after promote/abort/startup recovery/session cleanup;
- the project budget counts every physical byte in the v2 object/transient
  namespace, not only indexed success: committed/deleting objects, live GC tombs,
  unindexed orphan CAS files, retained unleased `.part`/staging files, and live
  staging, download, policy-output, and private-transfer-snapshot reservations.
  Startup and every admission reconcile the namespace under the project lock
  before granting capacity. A discovered unindexed file gets a durable orphan-
  charge row with observed size/identity/retention deadline; it stays charged
  until same-filesystem unlink plus directory fsync succeeds. A valid lease
  converts the physical file to its live reservation instead of double-counting
  it. Source and policy-output preflight reserves a conservative transient upper
  bound before writing bytes, then atomically adds a reservation for every unique
  new object before promotion. Both charges remain while staging and a CAS
  tmp/final object coexist; staging deletion releases only the transient charge.
  `openPinnedMediaTarget` separately
  reserves the private snapshot before copying. Live roots and the union of
  other valid reservations count against the cap and are never deleted to fit.
  Physical accounting charges the maximum of logical length, allocated blocks,
  and `4_096` bytes per filesystem entry and caps the complete object/transient
  namespace at `200_000` files plus directories, so sparse/zero-byte inode floods
  cannot bypass byte limits.
  Every cross-process lease/reservation therefore carries `reservedFileCount`
  and `reservedDirectoryEntryCount` beside bytes. It reserves each staging
  directory/file, object shard/tmp/final entry, private snapshot, and GC tomb
  before `mkdir`/create. Promotion or rename transfers count ownership without
  releasing it; only unlink plus parent-directory fsync releases the count.
  Multi-output descriptors reserve their maximum entry count before spawn, and
  startup reconstructs count reservations for live owners before admission.
  Two leases reserving the same object hash share one object-byte charge while
  each retains an ownership reference; transient copies are charged per copy.
  If an entire source/batch/snapshot still does not fit, it fails with its
  declared ENOSPC/policy semantics; partial promotion is never a successful
  invocation;
- adapter remote caches are scoped by profile/endpoint/credential instance and
  object generation, are not roots, and become immediate misses when generation
  changes; stale physical rows are removed asynchronously.

This liveness rule prevents every historical FileVersion from pinning bytes
forever while preserving its S5 fact. A persisted conversation or recently used
binary recall keeps required bytes alive; deletion/release of the last such root
eventually makes capacity recoverable. Storage maintenance mutates only the
catalog/journal, preserving S5's two semantic collection triggers and read-only
recall service.

No new provider credential or endpoint setting is introduced. Existing
`omni.processing.transportGuard.maxUploadFileBytes` remains the DashScope
adapter upload ceiling; `omni.delivery.upload.urlTtlHours` remains its remote
handle lifetime. MiniMax uses code-owned decimal limits. `omni.enabled` remains
the experimental opt-in, with description changed from "DashScope upload" to
"managed media processing with provider-selected delivery".

## 8. Implementation plan

### Slice 0: establish the correct baseline

1. Integrate exact `upstream/omni/s5-memory@d9eb5e37b0` (19 commits over S4).
2. Run unchanged S4/S5 policy, artifact-name, duration, execution-window,
   identity, registry, recall, collection, and reuse tests.
3. Reconcile the five older recognition/policy/storage/Memory/S5a design
   documents with this proposal.

### Slice 1: S5 v2, immutable identity, and lifecycle

1. Add the brokered application-data v2 namespace outside model tool roots,
   exact platform-root authority, atomic workspace-binding/project-lifecycle/
   aggregate-cap catalog, fixed broker path/root lifecycle stripe pools, central
   internal-storage deny boundary and managed
   shell mount isolation,
   watermarked three-way v1 importer/ID remap,
   exact locator canonicalizers, extensionless single-object layout, atomically
   embedded object/binding catalog, journaled identity/initial-Memory bootstrap,
   bounded authority/control metadata with a maintenance reserve, versioned
   recognition assertions, pending/reserved v1 backfill, plaintext scrub,
   authoritative cross-process storage settings/epoch, and persistent delivery
   groups with adopting/durable/unavailable/deleting arms.
2. Implement and package the audited `secureOpenBeneath` and `SecureFsRoot`
   relative N-API operations, pre-decode budgets, the per-user cross-process
   candidate-spool reservation/lease domain,
   handle-bound workspace authorization, quota-bound input/output sinks,
   post-recognition hash verification, dual transient/object capacity
   reservation, and the sole `openPinnedMediaTarget` byte-access API.
3. Implement handle-taint placeholders, session overlay, structured checkpoint/
   bootstrap recovery maps, sidecar fault semantics, creation-time managed-
   conversation selection, global conversation-generation allocation, encrypted
   broker-private session routes, fixed private writer-fence locators, a shared
   project-authorized route-resolved transcript API and generation-bound cursor
   for every reader/scanner, conversation-root bootstrap/reclamation intents,
   transcript/file-history physical reservations, persistent managed
   idle/live/delete fence records, stable authority-digest and cross-domain
   writer-transition recovery, temp-to-final fork publication, phased archive/
   delete fences, parent-directory fsync at every name transition,
   deterministic sidecar IDs,
   group-level sidecar/root/use adoption and deleting sagas, project-retirement
   route draining, legacy inline capture, and fresh-handle replay.
4. Implement broker-then-project locks, temp/object/reservation leases,
   assertion-specific policy uses and output edges, execution generations
   and nondeterministic rebuilds, durable conversation versus TTL owner roots,
   object-generation cache validation, corruption-to-missing,
   tree-aware roots, retention, staging/orphan cleanup, and multi-process/mixed-
   binary GC.
5. Give primary/same-project child/worktree transitions independent registries
   and correct project services/leases, cumulative taint ledger, and the
   source-close/new-destination-session boundary for conversations with managed
   sidecars.
6. Keep canonical-China `dashscope-oss-v1` candidate-only until its complete
   model capability matrix passes; all unverified DashScope routes remain
   legacy.

### Slice 2: routing, policy order, and MiniMax

1. Preserve provider ID and three-state modalities through config, runtime,
   bridge, and subagents; migrate only exact built-in MiniMax records.
2. Split wire protocol from AuthType; add exact profile/model/endpoint authority,
   credential source/instance and verified-TLS authority, downstream request
   plans, barrier-wave aggregates, and typed policy-processor profiles/contexts.
3. Preserve the S4 closure state machine and implement the complete versioned
   built-in overview descriptor/parity matrix.
4. Implement MiniMax JPEG/PNG overview and MP4 materialization with decimal
   per-media/body limits, frozen tool-choice, and reserved `extra_body` fields
   for both media and transcript-only managed requests.
5. Route TUI/ACP local, explicit URL, user inline, and tool inline once; bypass
   before side effects when no verified downstream profile and statically proven
   preprocessing route exist.

### Slice 3: physical egress and provider switching

1. Construct fresh per-call `ManagedOpenAIClient` instances with no inherited
   `fetchOptions`/dispatcher and inject validated fetch wrappers into inference,
   operation-specific DashScope upload, and processor clients; enforce closed
   operation-specific redirect/method/body/status, buffered JSON, deterministic streaming multipart, and the
   unique validated Request snapshot and max-attempt-one policy through every
   SDK and outer retry layer.
2. Implement `openai-managed-v1` with forced-off SDK/outer logging,
   pre-materialization request admission, adapter-owned header/body-idle
   deadlines, response admission, four code-owned response profiles, and
   complete bounded UTF-8/SSE/JSON/schema/credential validation before returning
   a response to the SDK. Add direct-only physical transport and
   `SensitiveEgressScope` integration with Qwen's Undici instrumentation; do not
   register Anthropic/Gemini adapters in this slice.
3. Re-materialize managed history and capture eligible legacy inline history;
   reject/unavailable foreign unowned handles.
4. Enforce side-effect checkpoints and retry-time config/trust revocation.
5. Enable `minimax-openai-inline-v1` only after fake service, regressions, and
   real MiniMax E2E pass; otherwise it remains disabled candidate code.

Future providers add a code-owned profile/adapter and reuse S5 v2 capture,
policy, history, lifecycle, and final-fetch contracts. They never widen an
existing adapter by settings.

## 9. Verification plan

### 9.1 Unit and contract tests

- Baseline: all authoritative S4/S5 tests, including latest artifact collision,
  duration, and execution-window fixes, pass before/after.
- Migration: concurrent v1/v2 writers, v1 current-version advance/revert,
  three-way pointer conflict, same-locator ID remap of the whole graph, v1
  local/managed/unbacked versions, non-conflicting ID/edge preservation,
  exact preservation of generation-zero execution/entry/output/lineage IDs,
  plaintext scrub, exact Linux/macOS/Windows broker-root derivation and hostile
  runtime/home overrides, wrong owner/ACL, symlink/reparse, network/removable
  filesystem rejection, broker identity/catalog bootstrap and missing/replaced-
  key behavior with zero/one/many project directories, project identity
  bootstrap crash at mkdir/lock/tmp/fsync/rename,
  bootstrap journal crash at prepared/identity/memory/cleanup phases and
  established identity with independently missing Memory fail-closed,
  missing/replaced committed key fail-closed, verified backfill, no durable ref
  before backing, crash-safe graph/catalog document write, v1 memory/object/cache
  import only through the retained no-follow parent handle, and malformed/
  truncated/checksum-invalid/cross-reference-invalid v2 entering recovery mode
  without rewrite, promotion, root mutation, or GC.
  Authority/v1/cache/sidecar byte cap minus/equal/plus one, depth 32/33,
  collection/reference/string limits, and normal multi-transaction growth
  exercise the 512-MB control cap, 64-MB maintenance reserve, old-plus-temp
  rewrite accounting, cache/journal compaction, and read-only state at admission
  exhaustion. Sparse and zero-byte files use allocated/minimum charges and the
  100k-control/200k-object-transient entry caps. A legal v1 snapshot and legal
  v2 graph whose union exceeds the v2 authority cap defer one closed import unit
  without blocking an unrelated v2 capture/root/GC transaction; repeated old-
  writer growth remains bounded and retryable.
  Workspace binding covers same-inode rename, copy, delete/recreate, marker copy,
  inode/file-ID reuse with distinct birth/creation identity, unsupported stable
  identity, symlink/reparse/oversize/malformed marker, marker delete/
  replace/runtime swap, every pending-catalog/marker-publish crash, cross-device
  move, explicit rebind crash, logical-locator canonicalizer upgrade, worktree unregister/
  recreate, and conversation-rooted inactive-project retirement. Broker aggregate
  project/byte/control/entry limits use ±1 and concurrent multi-project
  reservations. Normal pool saturation still permits broker old+temp rewrite,
  settlement, root-unavailable retirement, unregister, GC, and exact-once release
  from maintenance reserve. More than 257 create/retire/purge cycles compact rows;
  stale signed markers never replay a purged project. Retention racing project
  root/lease create/release always locks and trusts project authority; no stale
  broker count can cause premature sweep or permanent retention.
  The broker bootstrap atomically creates/manifests all 4,096 path and 4,096 root
  stripe files within control/entry limits; crash at each create/fsync/manifest
  boundary recovers only before committed broker state, while a later missing/
  replaced stripe fails closed. A path stripe survives whole-workspace recursive
  deletion and prevents same-path new-inode registration while the old delete
  holder lives; a root stripe binds marker/identity. Hash-collision fixtures
  serialize unrelated operations without aliasing full keys. Terminal purge
  never unlinks stripes, so later generations reuse the fixed pool without a
  cleanup crash window or lifetime row growth.
  A blocked workspace marker fsync does not block an unrelated project's broker
  reservation/GC; a live owner paused beyond the pending TTL cannot be compacted,
  while death before marker rename and after rename-before-CAS respectively roll
  back and complete under the path/root stripes. A terminal-purged stale marker is
  atomically replaced with a higher generation and fresh project, never the old
  ID; missing/corrupt broker authority cannot masquerade as purge proof.
  Native path-slot fixtures prove case variants on insensitive volumes, macOS
  Unicode-equivalent names, Windows short/long aliases, and a deleted/recreated
  parent at the same native namespace select one stripe; case-sensitive distinct
  entries remain distinct. Lexical parent aliases may select different path
  stripes but the physical root stripe serializes the same current root.
  An unsupported filesystem fails before registration. A frozen slot-v1 process
  racing a newer logical locator canonicalizer still serializes delete/recreate;
  any future native slot ABI/pool version requires old-binary drain rather than
  mixed stripe selection.
  A paused old deletion plus parent rename/recreate/new registration proves the
  old retained handle cannot touch the new child. Tests reject every mutable-path
  `fs.rm`/`git worktree remove` call and separate fd-bound recursive removal from
  identity-checked Git-admin prune. Git-admin failure before mutation may restore
  active only after full evidence validation; recursive removal partial failure,
  directory removal followed by prune/fsync failure, and contradictory Git/root/marker state remain
  delete-pending/recovery-required or converge to unregistered. Success/crash
  boundaries commit unregistered only after deletion fsync.
  `unregisteredAt`/`retireAfter` survive
  restart and clock rollback/forward guards. Retirement denies new leases but
  waits for live/suspended registry, descriptor, and transaction owners.
- Object layout: extensionless lowercase-base32 HMAC path, same SHA under
  conflicting MIME/extensions produces one charged object, v1 extensionful
  import collapse, invalid object ID rejection, and semantic snapshot suffix
  never changing CAS identity.
- Recognition assertions: same bytes under upgraded detector/config/backend,
  legacy partial to complete v2 assertion, stable identical assertion-key field
  conflict fail-closed, PATH-based runs receiving distinct run identity,
  FileRecognized/policy/registry/ref/group fields carrying the assertion ID,
  and persist/resume retaining recorded provenance while current egress is
  guarded only by a fresh assertion.
  File current version/assertion pair advances atomically; current and historical
  metadata/gap/advisor/side-query outputs identify their selected assertion.
- Locator: POSIX NFC/NFD sibling names remain two Files, lexical case/Unicode/
  Windows path, URL default port/dot/percent/query-order/duplicate
  canonicalization, ACP inline, nested tool part, retry/replay, independent
  invocation, same bytes/two Files.
- Capture: growing/shrinking input, final/intermediate symlink rejection,
  high-frequency intermediate-directory swap to an outside sentinel, root-bound
  native-handle workspace escape, hash
  mismatch, object replacement, dedup race, abort/revocation, staging recovery,
  POSIX FIFO/socket/device/directory rejection before blocking or staging,
  native helper missing/unloadable/unsupported-platform disabling local/inline/
  HTTPS managed ingress before candidate side effects,
  target-specific helper rejection never invoking legacy read, pre-existing
  broker/project component symlink and runtime storage-directory swap rejecting every relative
  create/open/rename/unlink/fsync,
  model read/write/glob/search/ACP/UI denial for broker and candidate roots,
  managed shell sandbox mount exclusion, and shell unavailable when isolation is
  absent. Local stdio MCP is explicitly classified as same-UID operator TCB and
  receives no internal path/ref/byte in protocol payloads; remote MCP receives
  no local filesystem authority. Tests and user-facing diagnostics do not claim
  `InternalStorageBoundary` isolates a configured local MCP process,
  cross-platform file-identity and private Policy Tool paths, path/file-URI/
  JSON-escaped stderr scrubbing, raw `inputPath/outputDir` model/Core/ACP
  rejection, and GC races against pinned policy reuse/history/materializer/tool/
  UI consumers.
- Budget: approximate-before-decode, decoded recheck, source and multi-output
  batch reservation, pre-promotion control-document reservation, transient
  staging/policy/snapshot reservation, byte/file/directory-entry ownership
  transfer and release,
  two-process reservation race, dedup object bytes versus per-copy transient
  bytes, cap below staging plus CAS tmp, counting-sink limit minus/equal/plus one,
  `.gc` tomb and unindexed orphan/retained `.part` charge through unlink failure,
  multi-project quarantine aggregate cap minus/equal/plus one, atomic transient-
  to-quarantine reclassification, rename/crash/sweep/unlink exact-once release,
  startup/admission reconciliation without double count, two CLI processes
  contending for the per-user 2-GB candidate spool, ledger byte/depth/row cap,
  live owner/plan/file/directory caps, zero-byte inode charge, corrupt-ledger
  fail-closed, active/suspended/dead owner cleanup and dual candidate/project
  reservation during transfer, runaway ffmpeg/ASR
  cancellation, abort/crash release, decimal MiniMax boundaries, base64/body
  expansion, ENOSPC recovery. Managed transcript/file-history coverage reserves
  cap minus one/equal/plus one, concurrent JSONL appends, large tracked-file
  backup, fork duplication, file/directory entries, partial-line truncate,
  acknowledgement loss, unexpected ENOSPC recovery-required, and crash settlement
  against both project and 50-GB aggregate pools.
  Authority/control exhaustion known before source or policy promotion creates
  no CAS object, durable row, or growing orphan set and follows the declared
  session-only/policy failure branch.
  V1 byte backfill imports metadata as pending first, reserves transient plus
  unique-object bytes per stable fd, handles partial capacity/dedup/concurrent
  old writer/copy-before-commit crash, leaves ENOSPC unbacked without blocking
  v2, and retries after capacity release.
  When one v1 unit and the requested v2 mutation each fit but their sum does not,
  the requested mutation's settled reservation wins and the unit watermark does
  not advance.
- Memory failure: source and derivative transaction faults; ephemeral outputs
  never call collection/reuse; request-to-session lease transfer supports
  initial delivery and a later tool round through the unified pinned API;
  cleanup removes the ephemeral target, while persist/resume is unavailable. A
  transcript larger than inline Memory survives persist/resume/reuse, then GC
  exercises deterministic rehydrate and a changed nondeterministic ASR
  generation. Its sidecar fallback remains the exact constant and never contains
  transcript/inline text.
- Handle liveness: persistent bind publishes a session root before disclosure;
  descriptor release plus concurrent GC cannot stale the next tool round;
  owner-token roots preserve two handles/two Files sharing one object when one
  unbinds; project switch/session end revoke resolution and release only their
  own roots. Process crash expires registry/descriptor/transaction lease roots
  while durable conversation roots survive until branch tombstone. Conversation
  handle-count and taint-byte caps admit limit minus/equal, reject limit plus one
  without evicting an old scrub entry, and disposal releases the complete
  registry/taint/lease memory after the last holder.
- Conversation: ordered multi-output/transcript/omission through record,
  assistant handle echo, recursive tool args, checkpoint/bootstrap recovery map,
  sidecar create/update/delete faults, resume/fork, rewind then resume/branch,
  conversation tombstone/GC, same-project child, worktree child, cwd enter/exit,
  managed-sidecar source close before project transition, close failure leaving
  cwd unchanged, fresh destination session with unavailable descriptors, later
  source-project resume, no-sidecar compatibility migration, cumulative old-
  handle taint through compression/bootstrap/fork/export, delete-time retry,
  parent-project concurrent GC, UI, trusted-hook payload sanitization without a
  filesystem-isolation claim, export/import. The external
  managed-conversation creation is killed before/after global generation
  allocation, root-bootstrap intent, root mkdir+parent fsync, root-published CAS,
  encrypted private-route write, bootstrap-intent consumption, claim
  create/file+parent fsync,
  broker transition intent, final physical-record install/file+parent fsync,
  physical-installed CAS, transcript exclusive create/file+parent fsync,
  transcript-identity CAS, active CAS, first sidecar, and first chat append.
  Resume, handoff, normal close to
  managed idle, and delete-terminal repeat every half-commit fixture. An
  existing legacy session cannot activate in place and creates no v2 state;
  starting a new managed session succeeds. Exact d9 cannot discover the private
  transcript/fence; an explicitly created same-ID legacy ghost is never merged,
  selected, or deleted by the managed resolver. A text-only first turn, a false-
  MIME first attachment followed by valid media, a no-attachment first turn,
  and project-bootstrap failure prove that mode is selected once before the
  first append and never changes because of later sniff results. Counter overflow,
  16,384-byte route cap ±1, AEAD/key/AAD/parent-identity mismatch, duplicate
  session-route HMAC, and 255/256/257 routes exercise the bounded admission and
  maintenance cleanup.
  Authority-digest fixtures prove the canonical target projection is identical
  in prepared intent, final physical record, and terminal broker row; changing
  any stable semantic field changes it, while AEAD nonce/ciphertext encoding,
  transition phase, fork publication progress, physical digest, and cleanup
  cursor cannot affect it. Schema
  construction tests reject any attempt to include a field whose digest depends
  on the physical record or transition serialization.
  Safe-integer generation tests cover `Number.MAX_SAFE_INTEGER - 1`, the final
  value, and rejected increment, while `2^53`/nominal uint64 JSON is rejected.
  A valid old-generation sidecar with a correct digest cannot satisfy a new
  route. Sidecar ID tests cover fixed base32 grammar, tuple recomputation,
  deterministic retry/fork shard, separator/dot/Unicode/case/collision
  rejection, and exact deleting-row cleanup.
  Resume/archive/delete from a renamed cwd/runtime base succeeds only after the
  caller resolves the same binding and always contends on the private writer
  fence. After worktree/project removal, ordinary resume/archive is unauthorized;
  purpose-limited maintenance recovery/delete resolves the source-project route
  without enumeration. A paused managed writer prevents another authorized
  runtime from resume/delete. Route validation proves every
  mandatory transcript/fence/sidecar/file-history target is beneath broker/
  project application-data roots for every retained state, including deleted;
  worktree deletion never needs or performs target containment inference.
  `SessionTranscriptReader`, cursor codecs, ACP/serve transcript routes,
  memory/session scanners, usage salvage, and SessionService all resolve the
  same route. Cwd rename, runtime-base change, active/archive states, and a
  conflicting new-location transcript with the same ID never change the selected
  file. A Project-B runtime that knows Project A's session ID cannot list,
  resume, fork, archive, or delete A; it receives the same not-found result as
  absence and may still use its own same-ID legacy file. Only an authenticated
  same-binding cwd rename works, while unregistered recovery requires a
  purpose-limited maintenance lease. Managed cursor tests cover cwd rename,
  worktree removal under maintenance, archive-state transition, route compact,
  higher-generation same-ID reuse, file-ID reuse, field/MAC tamper, and rejection
  of legacy cursor fallback after any managed mismatch. Archive/unarchive is killed in both
  moving states and reconciles exact active/archive identities. The
  `ConversationDeleteIntent` is killed before/after writer transition prepare,
  physical delete-terminal install, route delete-preparing/deleting CAS,
  usage salvage, project cleanup, and each active/archive transcript, managed
  sidecar, file-history unlink and parent fsync; organization cleanup's
  best-effort attempt is recorded. Paused sidecar/adoption/first append and
  archive/unarchive operations cannot cross the lifecycle fence or append after
  intent compaction. Restart always leaves the session non-resumable and forward-
  completes exact targets. Unlink failure, missing/corrupt chat, batched deletion,
  and acknowledgement loss cannot leak owners/roots or resume a tombstoned
  session. Omni-off deletion of a proven legacy-only conversation creates no v2
  identity; deletion of existing managed state still runs maintenance; ambiguous
  evidence fails closed.
  Terminal cleanup is killed before/after claim create/file+parent fsync,
  deleted-route cleanup intent, fence unlink+parent fsync, cleanup-phase CAS,
  claim unlink+parent fsync, root rmdir+parent fsync, final-phase CAS, and broker
  route compaction. A route never disappears before all private names are durably
  absent. Repeated root-bootstrap crashes neither leak an uncharged directory nor
  release an unknown occupant.
  Fork publication is killed before/after target generation allocation,
  planned fork-preparing route write, private-temp exclusive create, streamed
  write, temp file+parent fsync/fstat, temp-published CAS, no-replace rename,
  final parent fsync, published-identity CAS, each clone-group adoption,
  file-history completion, writer handoff, and active CAS. Listing/resume never
  exposes the target early; CLI branch, ACP fork, and config/session fork use the
  same creation-owner API, and rollback preserves every source owner. Project
  sweep/365-day retirement with a zero-group active route is blocked until its
  conversation-delete saga, fence drain, route compaction, and route-cap release
  complete; route creation racing retirement compares the project epoch.
- Policy: candidate/exact route proof, false MIME cleanup, text-only ASR without
  a media profile, false-MIME leaving no new media authority/credential digest and
  only a deleted OS-temp candidate directory, structural admission at
  `64/16/8/8/128 MiB` boundaries before
  staging, bounded four-source scheduling, whole-plan valid-JPEG plus false-MIME/
  WebP and nested-tool barriers, builtin-only overview name plus full failure
  parity, source Memory
  before guard, aggregate barrier waves, guard derivative re-entry, atomic graph/
  catalog transaction downgrade, ordering/reuse, exact processor authority,
  infinite/overlong SSE cancellation, segment/aggregate transcript, and
  processor request/response/output byte boundaries. ASR checks 511/512/513
  segments before allocation, never runs more than three ffmpeg/network workers,
  preserves order, and starts no later chunk after abort. Generic file artifacts
  retain 256 KiB; the ASR descriptor accepts 256 KiB + 1 through 8,000,000 and
  rejects limit + 1. Fragmented MP4/M4A fake/real playback and bounded per-frame
  image pipes prove the versioned stdout modes before enablement. First-slice
  media processors make no exact runtime identity claim and always allocate
  nondeterministic generations when missing backing is rebuilt.
  The exact `qwen-omni-asr-v2` request grammar accepts its one bound audio chunk
  and rejects extra/reordered parts, wrong format/hash/length, media overrides,
  tools/reasoning/audio output, and unknown fields. The same tool-bearing
  terminal fixture accepted by Qwen inference is rejected by
  `dashscope-qwen-omni-asr-v1`.
  Scheduler-private execution context supplies source/assertion and output lease
  authority without path-based re-recognition. Runtime-verdict recalled handles
  remain ephemeral until explicit re-reference. Assertion-specific executed/
  reused use records preserve decision provenance, and two same-SHA outputs with
  distinct output IDs produce distinct bindings/Files but one physical object.
  Two fixed policies plus one guard policy in one group, including cross-File
  reuse, create a symmetric B execution/output graph and attach item-level use
  IDs to ordered B-specific outputs. Dynamic `0..maxFrames` batches derive IDs
  after validation. Two invocations of the same FileVersion/assertion/config
  reuse one immutable execution-output set while producing distinct use-output
  IDs; retry, restart, and replay preserve that bipartite graph. Retry is
  idempotent; replay rejects item/use-output/execution-output,
  text-vs-file storage kind, changed omission/disclosure digest/template, and
  sidecar-text mismatches. Adapter presentation persists only a code-owned
  template/adjacent subject index; unknown template, free text, nonadjacent or
  wrong-kind subject is rejected.
  Actual overview and lossy media/file artifacts exercise attached
  `omniDisclosure` as an authenticated child of their artifact output through
  execute/reuse/replay/tamper. Missing media/text backing, invalid use, retired
  project, and unsupported current profile produce the bounded unavailable
  discriminant without order/index drift or sidecar rewrite.
  Pending PolicyUse contains no execution/outcome/output fields, derives its use
  ID only from pre-execution source/assertion/invocation identity, and survives
  only under a live in-flight owner; completed zero-output uses remain
  distinguishable. Union validation rejects mixed/unknown-arm fields. Provider or
  sidecar failure, dead-owner restart, and abort remove the use projection but
  retain the execution attempt. Canonical owner keys reject duplicates and make
  adoption/fork/tombstone replay idempotent. The explicit group-level sidecar/
  root-set/all-use adoption/chat-append/final-CAS saga is killed at every fsync/
  rename/append/CAS boundary for raw-only, raw plus two uses, media, zero-output,
  omission, and disclosure groups while GC races every window,
  including append success with lost acknowledgement; exact chat evidence
  plus exact sidecar forward-completes, absence plus dead owner rolls back.
  Fork/branch of raw plus two uses add target owners while preserving source
  owners; deleting source then target and the reverse leave the other group
  rooted until its own tombstone. Durable groups atomically enter non-rooting
  deleting rows; crash before/after root release, deterministic sidecar unlink,
  parent fsync, row removal, and intent count/digest update always resumes the
  exact target without repinning bytes. Corrupt sidecar quarantine cleanup is
  similarly charged and recoverable.
  Durable chat with deleted/truncated/bit-flipped/replaced sidecar creates one
  idempotent group correction, changes all uses to `conversation-unavailable`,
  releases all roots/adoption capacity, and later tombstones clean it;
  indeterminate reads remain recovery-required. Rewind/dead branch and
  last branch/conversation tombstone remove only exact durable owner keys.
  More than 100,001 repeated reuse occurrences become reclaimable as their
  conversation owners are tombstoned instead of permanently exhausting the
  authority cap.
- Config: tri-state modality, exact old MiniMax migration, M2.x/custom model,
  custom/suffix endpoint, changed path, candidate disabled, no-profile bypass,
  storage default/range/safe-integer/Date/checked-addition boundaries,
  authoritative project config epoch with two live processes and quiesced
  transition, physical config change without S5 recomputation, MiniMax `ANY`/
  `NONE`, and DashScope false/absent streaming rejection before capture.
- Request: reserved `extra_body`, exact model/path/method, redirect, custom auth,
  per-call concurrency, mutable headers/ArrayBuffer, deterministic multipart
  boundary/content-length/file-last, near-1-GiB RSS/backpressure, 301/302/303/307/308,
  retry revocation, direct dispatcher/timeout preservation and every proxy source
  rejected before capture, two-way
  manifest, media-free transcript request, malicious extra-body media,
  tool-choice derivation, ordinary URL/path text, credential taint, exact China
  DashScope required headers/OSS host/form, canonical string/number numeric
  fields, decimal 1GB and image dimension/aspect boundaries, body-before/after
  dispatch retry ambiguity, managed inference/processor POST `maxRetries:0`,
  a legacy shared client containing the normal runtime dispatcher versus a fresh
  managed client whose SDK `fetchOptions` is absent and whose only physical
  dispatcher is the exclusive Agent (proxy/no-proxy/TLS-insecure variants),
  outer `retryWithBackoff`/stream/model-fallback max-attempt-one enforcement,
  buffered-JSON 64-MB and deterministic-multipart decimal-1-GB boundaries,
  exact OSS 200-empty success versus 200-nonempty/201/204 failure; ACL must be
  exact `private` and forbid-overwrite exact `true`, with public/false/case/
  duplicate/missing variants producing zero OSS POST/cache publication. Hostile
  `OPENAI_ORG_ID`/`OPENAI_PROJECT_ID` and custom headers never
  appearing in a non-OpenAI request, closed discriminated operation profiles:
  inference/processor no-query plus Bearer, getPolicy exact action/model query
  plus Bearer, issued OSS exact issued URL plus multipart credentials and no
  Authorization, and source exact consented query, `GET`, absent body, and no
  provider/form/cookie/proxy credential. Source accepts only final `200`, rejects
  `201/202/204/206`, accepts redirects only at `301/302/303/307/308`, and rejects
  every other 3xx before staging/CAS/Memory/provider I/O. Caller method/body are
  rejected before Fetch. The same 301/302/303/307/308 fixture proves the first four arms
  use `redirect:error` and issue no second request, while source uses
  `redirect:manual`, exposes only bounded Location internally, and creates a
  fresh DNS-pinned/revalidated arm and dedicated request for an authorized hop.
  Cross-arm redirect/credential/query reuse is rejected,
  getPolicy/issued-scope/OSS-post count exhaustion and absolute upload deadline,
  all argv/settings/environment proxy sources disabling the managed route, exact trusted
  values/provenance for allowed User-Agent/Accept/x-stainless headers, official
  ASR first-frame assistant role plus null standard fields, and wrong/repeated
  role or non-null `logprobs` rejection,
  issued OSS credential handle cap/zeroization/expiry and separate taint matching
  across header/body/log chunk boundaries,
  direct raw TLS capture matching exact HTTPS `Connection: close` plus
  `Accept-Encoding: identity` and absent/exact-identity response encoding;
  gzip/br/deflate, duplicates, omissions, and caller overrides fail before body
  forwarding. Pre-parser complete-message, transfer-decoded `onData`, and
  decoded-body caps independently exercise cap minus/equal/plus one for content-
  length, chunked/no-length, long chunk-size lines/extensions, many zero-length
  chunks, CRLF-only framing, trailers, trickle, malformed compression, empty-
  output gzip padding, and compression-bomb fixtures across all five operation
  classes. Each fixture proves a dedicated non-reused connection, destruction
  and lease release at the failing byte, and no bytes from a later response
  being counted against the first. The suite also covers
  the pinned `UndiciPhysicalHeaderProfile`, with runtime/instrumentation/version/
  unknown-header fail-closed. Telemetry outfile/fake OTLP/raw TLS tests prove
  sensitive egress emits no span, `traceparent`, signed URL/query, endpoint query,
  credential, or media; propagation on/off cannot mutate the wire after validation,
  source localization transport context recheck after paused DNS and redirect
  under proxy/global-dispatcher/TLS/config mutation,
  raw/non-success/SSE line/SSE event response cap minus/equal/plus one before any
  SDK/UI event, MiniMax terminal finish event with optional usage/`[DONE]`, EOF
  before terminal and complete-tool-args-without-terminal rejection, serialized
  MiniMax request `n` absent/override rejected, exactly one index-0 response
  choice, `base_resp.status_code` zero/nonzero/malformed in stream and nonstream,
  and MiniMax/DashScope/standard-ASR response-profile cross-rejection. Serialized
  transcript-only request body boundaries, oversized
  `Content-Length`, malformed UTF-8/JSON, `{error}`, `event:error`, HTTP-200 non-
  SSE/`error_finish` redaction, forced SDK/outer logger-off under `OPENAI_LOG=debug`, TLS-
  insecure direct and any-proxy rejection, credential source versus instance rotation,
  slow active response beyond the header deadline, headers/event then idle,
  trickle response and idle-disabled silence stopped by the absolute deadline,
  URL redirect/trickle absolute deadline, user abort, process response-admission at 10 and
  64 concurrent near-cap responses plus no-length growth and release after every
  failure, request-materialization admission before object read/base64/SDK at
  2/10/64 near-cap JSON requests, bounded waiter/abort release, cap+1 before SDK
  encoder, and multipart concurrency two, JSON-escaped/cross-event response-header/text/reasoning/tool-arg old and current
  credential echo never displayed/persisted, Anthropic/Gemini transcript-only
  managed route unavailable without global-fetch mutation, rejected unsupported
  models/regions, and ASR override.
  Direct Agent contract tests freeze connect/headers/body timers at zero and
  `maxHeaderSize=32_768`: delayed connect/header/body crosses Undici's old
  defaults but only adapter deadlines abort, while raw TLS headers at cap-1/cap/
  cap+1 stay bounded even under a larger Node startup flag. Accepted headers are
  charged through semantic release. The patched parser counts fragmented/trickle
  reason phrases before string allocation at 1,024 minus/equal/plus one and
  jointly under the 32-KB raw-header cap; final `200` and `103` variants never
  expose `statusText`, and a patch/version digest mismatch disables the route.
  Zero informational responses proceed: `100` follows the pinned parser-error/
  wrapper-`onError` cleanup path, `101` follows the unavailable-upgrade path, and
  `103` plus repeated near-32-KB blocks follows wrapped `onHeaders`; each aborts
  before a final response, retry, or cache publication for all five physical
  operation classes. Conversation disposal racing late header/
  body/semantic scan holds a matcher lease, releases no content, rejects new
  requests, and zeroizes only after the last holder exits.
- Concurrency: old-v1 and two v2 processes capture/commit/heartbeat/recall/GC;
  no lost v2 update, corrupt rename, stale handle, or sweep of another process's
  temp/object. Bitrot/size corruption uses the charged tomb protocol through
  every crash boundary and enables deterministic/nondeterministic rehydrate;
  object-generation lookup makes independently persisted stale cache rows miss.
  GC recovery covers both `missing + tomb-row` and `deleting` with neither object
  nor tomb path after unlink/fsync crash boundaries, releasing capacity once.

### 9.2 Integration tests

- TUI `@local`, explicit `@https`, `read_file`, top-level/nested tool inline,
  ACP initial and mid-turn attachments.
- Primary text-only + Vision Bridge, primary MiniMax, differing subagent, and
  MiniMax audio -> authorized ASR transcript -> MiniMax text; assert separate
  contexts/credentials and no source-modality early bypass.
- Existing image overview parity: dimensions, JPEG, zoom hint, source above raw
  cap, renderer failure, and Omni-off comparison.
- DashScope -> MiniMax -> DashScope rematerializes new-history media when both
  support it; profile-disabled state is explicitly unavailable; legacy inline
  is captured, foreign legacy handles are not forwarded.
- Two attachments separately below but jointly above a request policy threshold
  receive one aggregate namespace and deterministic degradation.
- Trust/config revoked during capture, policy processor, upload, inference, and
  the permitted getPolicy/OSS retry prevents the next side effect and cleans
  staging.
- Transport video -> audio guard derivative -> user audio transcription proves
  fixed-policy closure re-entry and a recomputed multi-root wave.

### 9.3 E2E acceptance

1. Fake and credential-gated real canonical-China `qwen3.5-omni-plus` cover the
   exact JPEG/PNG, WAV/MP3, and MP4 table, automatic tools, streaming, policy
   required headers, upload/cache, and only owned `oss://` references before the
   public scope is enabled. The real run must prove the exact public inference
   endpoint rather than extrapolate from the upload contract; otherwise the
   candidate is removed. Unsupported formats/models/auth types, non-streaming
   requests, and international, US, workspace, Token Plan, internal, subdomain,
   and proxy fixtures never enter this profile without their own typed authority
   entry/evidence.
2. Fake MiniMax receives only exact M3 image/video shapes at an allowed final
   path, never `/uploads`, `oss://`, a DashScope header, M2.x, overwritten model,
   or a key at a secondary origin; an over-64,000,000-byte serialized body is
   rejected locally.
3. With real MiniMax credentials in an isolated project, each endpoint scope
   independently runs four cells: media-only non-stream, media+stream,
   media+tools, and media+tools+stream. The set includes one JPEG overview, one
   MP4, and an actual automatic tool-call round trip; `tool_choice` remains
   absent. Redacted capture proves final endpoint/model/media/header properties.
   All four cells are mandatory before that exact scope is labelled verified;
   `.io` success never enables `.com`. This design does not claim either ran.
4. Session A creates a version/Memory fact and handle. Resume binds a different
   handle and rematerializes the ordered group. A genuinely fresh Session B has
   no handle until explicit re-reference, then reuses object/policy without
   duplicate tool execution and receives a new handle.
5. Two paths with equal bytes stay two Files, one CAS object, reusable analysis.
6. Two simultaneous CLI processes prove lock/lease/GC safety.
7. Omni-off, untrusted, and routes with neither an enabled native profile nor a
   complete authorized preprocessing path create no new filesystem/network
   effect and retain the old provider behavior. A disabled media profile plus a
   separately authorized transcript-only route exercises only that processor.

The acceptance report records exact commit/provider/model, normalized endpoint
scope, surfaces, fixture SHA, redacted request properties, object/Memory counts,
policy invocations, and untested boundaries. It never records keys, raw URLs,
paths, locator HMACs, object IDs, or model-visible hashes.

## 10. Rollout and observability

- Roll out behind existing `omni.enabled` plus a code-owned MiniMax profile
  enablement gate.
- Keep MiniMax disabled candidate-only until fake-service, full regression, and
  per-endpoint real-provider gates pass. DashScope remains the only adapter
  during Slice 1.
- Record only adapter/profile version, provider/model ID, entry surface,
  modality, outcome, guard reason, and coarse size bucket. Never record path,
  URL, SHA, endpoint query/userinfo, locator, object ID, `resourceId`, or key.
- Wrap source localization, managed inference/processor, getPolicy, and OSS in
  `SensitiveEgressScope`; pinned Qwen Undici instrumentation must ignore these
  physical requests and inject no trace header. Tests inspect telemetry outfile,
  a fake OTLP collector, logs, metrics, and raw TLS requests for a signed query.
  Arbitrary user-injected in-process instrumentation is part of the trusted
  operator TCB, not a supported isolation boundary.
- Adapter rollback disables new MiniMax media safely but leaves an independently
  authorized transcript-only processor route available. Complete rollback uses
  `omni.enabled=false`. Existing managed history remains stored but is
  unavailable until a compatible profile is re-enabled; no wire reference is
  leaked or rewritten.

## 11. Rejected alternatives

- **Remove the DashScope hostname gate.** Crosses credential/protocol boundaries.
- **Treat all OpenAI-compatible providers alike.** Does not define media or
  endpoint constraints.
- **Use model names or suffix hosts as authority.** Both are editable and cannot
  authorize credentials.
- **Persist wire Parts or `resourceId`.** They expire or are session/provider
  capabilities, not identity.
- **Guard raw source with final adapter caps.** Prevents legal preprocessing and
  contradicts S4 ordering.
- **Scan arbitrary prompt text for URL/path strings.** Confuses ordinary code
  conversation with structured media provenance.
- **Pre-serialize outside the SDK.** Misses final URL/auth/retry and risks
  replacing established transport behavior; injected fetch sees the real
  request.
- **Make custom upload profiles configurable.** Lets settings redirect keys and
  handles without a reviewed boundary.
- **Fetch tool-result URLs automatically.** Adds network effects without explicit
  user consent.

## 12. Audit record

### Round 1: open-ended audit, 2026-08-12

Three independent Sub Agents audited revision 1 from design/correctness,
S4/S5-history, and provider-contract perspectives. All found new problems:

- design/correctness: 18 findings;
- S4/S5 archaeology: 12 findings;
- provider/converter matrix: 12 findings.

Revision 2 replaced the stale S5a baseline, split protocol/authentication,
restored three-level provenance and policy groups, removed persistent handles,
defined immutable capture/Memory-failure behavior, narrowed MiniMax formats, and
added request validation/storage governance.

### Round 2: reverse audit, 2026-08-12

The same three agents tried to falsify every Round 1 correction and then audited
from zero. The round was not clean:

- design/correctness: 9 new, 2 residual;
- S4/S5 archaeology: 8 new, 1 residual;
- provider/converter matrix: 8 new, 1 residual.

Revision 3 addresses the merged findings: latest 19-commit baseline; S4 policy/
guard order; exact model/endpoint/decimal limits; no-profile eligibility;
separate policy processors; multi-root request aggregation; v2 migration and
versioned locators; persisted groups/session overlay; ephemeral policies;
cross-process lock/leases/liveness; physical SDK fetch validation; structured
manifest checks; safe rollback; and complete checkpoint/verification matrices.
Round 3 must again distinguish new findings from repeats and is clean only if
all three agents report zero new problems and no correctness residual remains.

### Round 3: open-ended and reverse audit, 2026-08-12

Three agents rechecked every Round 2 correction and then audited revision 3 from
zero. The round was not clean:

- design/correctness: 10 new, 1 residual;
- S4/S5 archaeology: 7 new, 5 residual;
- provider/converter matrix: 5 new, 2 residual.

Revision 4 addresses the merged findings: disjoint mixed-binary-safe v2 storage;
exact locator canonicalization and key-loss/plaintext migration; storage catalog
and read-only recall journal; handle taint plus checkpoint/bootstrap correlation;
sidecar faults; conservative profile-required route proof; typed ASR processor;
barrier-wave/guard closure; complete legal overview policy; source/derivative
transaction downgrade; immutable transfer descriptor; per-call unique SDK
Request; base versus media validators; DashScope policy/issued-upload scopes;
full MiniMax candidate constraints and per-endpoint verification; lease-owned
temporaries; and revised Memory/storage decisions. Round 4 applies the same
zero-new-problem and zero-correctness-residual exit rule.

### Round 4: open-ended and reverse audit, 2026-08-12

The S4/S5 archaeology and provider/wire agents completed full revision 4
audits; the design/correctness run was interrupted after exceeding its bounded
review window, after the round was already known to be non-clean:

- S4/S5 archaeology: 8 new;
- provider/converter matrix: 6 new, 0 prior residual;
- design/correctness: no final count; it must re-audit revision 5 from zero.

Revision 5 addresses the merged findings: candidate versus exact route gates;
text-only authorized preprocessing without a media profile; one atomic v2 graph/
catalog document; watermarked three-way v1 merge and whole-graph locator ID
remap; builtin-only overview provenance; lease-before-handle recall;
branch/rewind roots; closed Undici transport options; one route tuple in the
delivery context; exact ASR request caps; MiniMax `tool_choice` and real-E2E
matrix; and an official-contract-backed canonical-China DashScope upload scope.
Round 5 again requires all three agents to complete and report zero new problems
and zero correctness residuals.

### Round 5: open-ended and reverse audit, 2026-08-13

All three agents completed revision 5 review. Every Round 4 item was fixed, but
the round found new problems:

- design/correctness: 1 new, 1 residual;
- S4/S5 archaeology: 6 new;
- provider/converter matrix: 4 new.

Revision 6 addresses the merged findings: frozen/final `toolChoiceMode`;
redirect-error construction; bounded JSON versus deterministic streaming
multipart validation; reserved fields and zero-media proof for transcript-only
requests; a complete candidate-only DashScope model/auth/capability table plus
required getPolicy headers; object-level catalog with version/entry bindings;
deterministic rehydration versus nondeterministic execution generations; one
pinned-object API for every byte consumer; project/worktree registry ownership;
atomic identity bootstrap; and lease-backed whole-batch storage reservations.
Transient staging, processor-output, and immutable transfer copies are charged
under the same project lease budget rather than bypassing the object cap.
Round 6 repeats the zero-new-problem and zero-correctness-residual exit rule.

### Round 6: open-ended and reverse audit, 2026-08-13

All three agents completed revision 6 review. The round again found new
correctness problems:

- design/correctness: 4 new, 1 residual;
- S4/S5 archaeology: 3 new, 2 residual;
- provider/converter matrix: 6 new, 0 residual.

Revision 7 addresses the merged findings: identity-preserving legacy generation
zero; a unified persistent/ephemeral pinned-target API with cross-platform
private paths for Policy Tools; dual transient/object reservation and
quota-enforcing writers; handle-bound workspace open; a whole-request exact
eligibility barrier; bounded streaming ASR response/transcript; cumulative
handle taint and crash-safe cross-project sidecar cleanup; typed mandatory
streaming and Qwen image dimensions; decimal DashScope upload limits; strict
getPolicy numeric normalization; evidence-gated public Qwen inference; and
operation-specific ambiguous OSS retry. Round 7 applies the same strict exit
rule: all three reports must contain zero new problems and zero correctness
residuals.

### Round 7: open-ended and reverse audit, 2026-08-13

All three agents completed revision 7 review. The round was not clean:

- design/correctness: 5 new, 0 prior residual;
- S4/S5 archaeology: 5 new, 1 residual;
- provider/converter matrix: 6 new, 3 residual.

Revision 8 addresses the merged findings: source-close/fresh-session project
switching instead of an unprovable cross-project cleanup saga; session-lease
roots before persistent handle disclosure; descriptor-specific artifact caps;
versioned quota-safe fragmented media and bounded keyframe output; physical
charges for GC tombs, orphan CAS, and retained partials; an implementable
authorize-then-double-open regular-file protocol; strict ASR input/wire limits,
shared transcript quota, and pre-persistence credential taint; zero automatic
retry for non-idempotent managed POSTs; bounded provider/error/SSE responses;
experimental-only DashScope temporary upload; private Policy Tool path
sanitization; and whole-ingress structural/concurrency admission before staging.
Round 8 repeats the same exit rule from a fresh reading of the full revision.

### Round 8: open-ended and reverse audit, 2026-08-13

All three agents completed revision 8 review. The round was not clean:

- design/correctness: 2 new, 3 residual;
- S4/S5 archaeology: 5 new, 1 residual;
- provider/converter matrix: 6 new, 0 residual.

Revision 9 replaces string-based workspace authorization with a packaged
root-handle-relative native helper and closes the remaining integration
boundaries: model/client tools accept only handles; v2 CAS has one extensionless
physical locator; session lease roots have independent owner tokens; runtime
processor identity participates in generations; corruption atomically becomes a
charged `missing` object; storage settings are safe-integer bounded and use one
cross-process authoritative epoch; credentials have source and secret-instance
identities; official profiles require verified TLS; all SDK and outer retry
layers enforce one attempt for managed POSTs; base request/response/error limits
cover transcript-only and semantic-200 failures; streaming failure is explicitly
incomplete rather than magically retractable; and provider credential echoes
are held back and rejected before display, persistence, or cross-provider use.
Round 9 again requires a complete zero-new/zero-residual report from all three
agents.

### Round 9: open-ended and reverse audit, 2026-08-13

All three agents completed revision 9 review. The round was not clean:

- design/correctness: 2 new, 2 residual;
- S4/S5 archaeology: 4 new, 0 residual;
- provider/converter matrix: 3 new, 2 residual.

Revision 10 closes those boundaries while deliberately narrowing the first
slice: only routes with `openai-managed-v1` may enter managed physical egress;
Anthropic/Gemini remain legacy until they gain protocol-specific adapters. Local
security verdicts cannot fall back; both source and internal storage use one
root-handle-relative native module. Conversation roots are durable v2 records,
while registry/descriptor/transaction roots are TTL lease records. Object
generation makes stale independent cache files inert. Candidate sniffing creates
only an OS-temp staging directory and initializes project identity after exact
proof. Local locators preserve Unicode distinctions, text fallback is constant,
and first-slice media processors make no exact runtime-fingerprint claim.
Finally, the managed OpenAI client forces all SDK logging off and completely
buffers, decodes, schema-validates, and credential-scans bounded responses before
the SDK/UI sees any event; conversation-lifetime matcher material covers rotated
credentials and decoded semantic channels. Round 10 again requires all three
agents to report zero new problems and zero correctness residuals.

### Round 10: open-ended and reverse audit, 2026-08-13

All three agents completed revision 10 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 6 new, 1 residual;
- provider/converter matrix: 3 new, 0 residual.

Revision 11 closes those findings. A code-owned per-user candidate spool now
provides cross-process reservation, ownership, heartbeat, cleanup, and a 2-GB
hard cap without creating project identity; project reservation begins only
after exact proof and overlaps transfer. The packaged native module is a
prerequisite for every managed route, and its stable parent handle also contains
all v1 reads and v2 cache writes. Corrupt `memory-v2.json` fails the project
closed instead of rebuilding empty state. JSON and multipart request caps are
separate, issued OSS success is exactly HTTP 200 with an empty body, and GC
reconciles absent object-and-tomb crash states with one capacity release.
Managed OpenAI response handling now uses an SDK subclass with adapter-owned
header and body-idle deadlines, a process-wide response-admission budget, and an
endpoint terminal automaton before any SDK/UI event. Round 11 again requires all
three agents to independently report zero new problems and zero correctness
residuals.

### Round 11: open-ended and reverse audit, 2026-08-13

All three agents completed revision 11 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 6 new, 0 residual;
- provider/converter matrix: 4 new, 0 residual.

Revision 12 closes those findings. Identity and initial Memory now use one
journaled bootstrap; all authority/control documents have pre-parse structural
limits, a separate 512-MB physical cap, and a 64-MB maintenance reserve.
FileVersion recognition is a versioned immutable assertion, while v1 metadata
import and byte backfill are separated so ENOSPC cannot block v2. The undefined
durable-policy exception is removed and ASR explicitly retains its 512-segment,
three-worker bound. Managed egress acquires request-materialization memory before
object reads/base64/SDK serialization, rejects MiniMax request `n`, checks
`base_resp`, and freezes distinct MiniMax, DashScope, and standard-ASR response
profiles. Round 12 repeats the strict requirement that all three independent
reports contain zero new problems and zero correctness residuals.

### Round 12: open-ended and reverse audit, 2026-08-13

All three agents completed revision 12 review. The round was not clean:

- design/correctness: 2 new, 2 residual;
- S4/S5 archaeology: 2 new, 4 residual;
- provider/converter matrix: 4 new, 0 residual.

Revision 13 closes the merged findings without adding a new generic layer.
Recognition assertion identity now reaches FileRecognized, policy bindings,
registry handles, refs, and groups; PATH-based probes use per-run identity, and
historical assertions are provenance while every current egress requires fresh
recognition. V1 import proceeds in capacity-bounded closed subgraphs. Candidate
spool and project leases reserve bytes plus filesystem-entry counts, and source/
policy paths reserve control-document growth before persistent effects. ASR has
exact request and narrowed response profiles. Managed OpenAI requests clear
OpenAI account headers and enforce a closed header allowlist; proxy bypass state
is frozen; and DashScope policy/upload retries share fixed counts and an absolute
deadline. Round 13 again requires all three independent reports to contain zero
new problems and zero correctness residuals.

### Round 13: open-ended and reverse audit, 2026-08-13

All three agents completed revision 13 review. The round was not clean:

- design/correctness: 2 new, 1 residual;
- S4/S5 archaeology: 1 new, 3 residual;
- provider/converter matrix: 2 new, 2 residual.

Revision 14 moves v2 private state to a brokered application-data root excluded
from model tools, gives the requested v2 mutation admission priority over v1
maintenance, and closes assertion provenance through an atomic current pointer,
scheduler-private policy context, ephemeral runtime-verdict policies, and
assertion-specific policy-use records. Policy results join by output ID rather
than content hash. Managed headers now validate trusted values as well as names,
all proxy sources freeze bypass state, ASR accepts the official bounded role/null
wire shape, and inference/processor/URL operations have non-resettable hard
deadlines. Round 14 repeats the zero-new-problem and zero-correctness-residual
exit rule.

### Round 14: open-ended and reverse audit, 2026-08-13

All three agents completed revision 14 review. Every prior item was fixed, but
the round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 4 new, 0 residual;
- provider/converter matrix: 3 new, 1 residual.

Revision 15 gives the broker a single atomic workspace-binding, project-
lifecycle, aggregate-cap catalog under exact platform application-data roots;
operator hooks are explicitly trusted rather than falsely sandboxed. Each
policy-derived item now points to a use record with ordered B-specific output
edges. The ASR response profile admits only the official null `logprobs` shape;
physical transport headers/CONNECT have a pinned Undici profile; temporary OSS
credentials use short-lived zeroizable handles and a separate taint domain; and
source localization freezes and revalidates its direct TLS/proxy context. Round
15 again requires all three reports to contain zero new problems and zero
correctness residuals.

### Round 15: open-ended and reverse audit, 2026-08-13

All three agents completed revision 15 review. The round was not clean:

- design/correctness: 4 new, 1 residual;
- S4/S5 archaeology: 5 new, 0 residual;
- provider/converter matrix: 2 new, 1 residual.

Revision 16 restores the symmetric S5 execution-output graph for cross-File
reuse, authenticates semantic policy outputs, and derives dynamic artifact IDs
from the scheduler invocation and validated order. Broker registration now has a
signed marker saga, project authority is the sole root/lease truth, global
maintenance reserve guarantees cleanup progress, and retirement/purge has an
exact terminal state. Registered roots remain conversation-owned while explicit
unregistered-project retirement first makes them unavailable. The first physical
client is narrowed to direct verified HTTPS, Qwen instrumentation suppresses all
sensitive egress spans/propagation, HTTPS runtime headers match the pinned wire,
and OSS upload accepts only private, forbid-overwrite form literals. Round 16
again requires all three reports to contain zero new problems and zero
correctness residuals.

### Round 16: open-ended and reverse audit, 2026-08-13

All three agents completed revision 16 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 6 new, 0 residual;
- provider/converter matrix: 2 new, 0 residual.

Revision 17 models S4 artifact-attached disclosure as an authenticated child of
the same output and gives unavailable state an explicit bounded item. Broker
marker publication no longer holds the global lock across workspace fsync;
worktree deletion is a compensating saga, unregistered deadlines are persisted,
retirement blocks new leases and waits for every live owner, and purged stale
markers can register only a higher-generation empty project. Managed response
credential matchers use request leases through asynchronous disposal. The direct
Undici Agent now freezes connect/header/body timers and physical header size so
only adapter deadlines and admission budgets govern the request. Round 17 again
requires all three reports to contain zero new problems and zero correctness
residuals.

### Round 22: open-ended and reverse audit, 2026-08-13

All three agents completed revision 22 review. The round was not clean:

- design/correctness: 2 new, 0 residual;
- S4/S5 archaeology: 2 new, 1 residual;
- provider/converter matrix: 0 new, 1 residual.

Revision 23 gives managed sessions a broker-indexed, AEAD-protected route to the
original project/runtime storage and a globally monotonic conversation
generation with an explicit activation handshake. Group records now retain a
deterministic sidecar locator through a non-rooting deleting arm; fork/branch
adds only target owners and never replaces source ownership. Delete/recovery,
archive/unarchive, resume, and worktree removal all resolve the session route
instead of guessing from current cwd. Finally, redirect joins the physical-
operation discriminant: provider/upload arms require `error`, while source
localization alone uses bounded `manual` hop-by-hop reauthorization. Round 23
again requires all three reports to contain zero new problems and zero
correctness residuals.

### Round 23: open-ended and reverse audit, 2026-08-13

All three agents completed revision 23 review. The round was not clean:

- design/correctness: 4 new, 0 residual;
- S4/S5 archaeology: 5 new, 1 residual;
- provider/converter matrix: 0 new, 0 residual.

Revision 24 makes the generation a safe-integer value carried by every sidecar
and persisted group, gives sidecars a deterministic project-HMAC ID, and freezes
the original SessionWriterLease domain inside the encrypted broker route. One
route resolver now serves SessionService, transcript readers, ACP/serve, cursors,
and background scanners. Fork targets remain hidden in a crash-recoverable
`fork-preparing` publication saga until transcript, group, file-history, and
writer handoff all complete. Finally, every nonterminal session route blocks
project retirement and is deleted through the normal conversation saga before
project authority can be purged. Round 24 again requires all three reports to
contain zero new problems and zero correctness residuals.

### Round 24: open-ended and reverse audit, 2026-08-13

All three agents completed revision 24 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 4 new, 0 residual;
- provider/converter matrix: 2 new, 0 residual.

Revision 25 makes the managed writer fence a persistent schema-3 sentinel that
old binaries cannot acquire and represents normal idle, live, transition, and
delete-terminal states. Broker route changes and the physical fence now converge
through an explicit recoverable two-domain transition rather than a fictitious
single CAS. Fork transcript proof advances from planned absence to published
file identity; worktree deletion blocks when it would remove a routed mandatory
target. Managed OpenAI clients are freshly constructed without inherited SDK
`fetchOptions`, while source localization is a closed GET/no-body operation that
accepts only final 200 and the enumerated manual redirect statuses. Round 25
again requires all three reports to contain zero new problems and zero
correctness residuals.

### Round 25: open-ended and reverse audit, 2026-08-13

All three agents completed revision 25 review. The round was not clean:

- design/correctness: 4 new, 1 residual;
- S4/S5 archaeology: 2 new, 2 residual;
- provider/converter matrix: 0 new, 0 residual.

Revision 26 replaces in-place legacy-session activation with an immutable
creation-time managed mode. Managed transcript, archive, history, sidecar, and
writer-fence targets now live only in broker/project application-data roots
that d9 cannot enumerate, so correctness no longer depends on the legacy
`SessionWriterLease` feature being enabled. The broker/physical transition uses
a stable non-circular authority projection and fsyncs every created, published,
replaced, or removed name plus its parent. Fork writes a deterministic private
temporary transcript before a no-replace final rename. Terminal cleanup keeps
the deleted route until both fence and claim names are durably absent. Mandatory
managed targets can never be inside a worktree, removing runtime-locator
containment ambiguity. Round 26 again requires all three reports to contain zero
new problems and zero correctness residuals.

### Round 26: open-ended and reverse audit, 2026-08-13

All three agents completed revision 26 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 3 new, 0 residual;
- provider/converter matrix: 0 new, 0 residual.

Revision 27 adds a journaled conversation-root bootstrap and retains terminal
route authority through root rmdir/parent fsync. Managed versus legacy mode is
now chosen exactly once by the session factory from static trusted capability,
not the first attachment's sniff result; false media affects only that turn's
media path. Direct route lookup requires matching project/binding authority,
while broker maintenance uses a separate purpose-limited lease. Managed cursors
bind route, project, generation, archive state, and file identity. Transcript,
fork, and file-history content now use durable pre-write reservations in both
project and per-user physical pools, including partial-write recovery. Round 27
again requires all three reports to contain zero new problems and zero
correctness residuals.

### Round 17: open-ended and reverse audit, 2026-08-13

All three agents completed revision 17 review. The round was not clean:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 4 new, 0 residual;
- provider/converter matrix: 1 new, 0 residual.

Revision 18 separates immutable execution-output identity from each invocation's
use-output occurrence, so repeated use never rewrites an attempt-owned graph.
Marker recovery now waits for exact dead-owner proof under the root lock, treats
the healthy broker catalog as terminal-purge authority, and classifies partial
worktree deletion by observed state rather than command status. Conversation
handle/taint storage and cross-project quarantine receive hard aggregate
admission. The physical dispatcher rejects informational responses before Fetch
can discard them. Round 18 again requires all three reports to contain zero new
problems and zero correctness residuals.

### Round 18: open-ended and reverse audit, 2026-08-13

All three agents completed revision 18 review. The round was not clean:

- design/correctness: 1 new, 1 residual;
- S4/S5 archaeology: 3 new, 0 residual;
- provider/converter matrix: 1 new, 0 residual.

Revision 19 places the per-root transaction lock in the broker authority and
gives it exact identity, accounting, and terminal cleanup. PolicyUse becomes
conversation occurrence state whose pending and durable owners are reclaimed
without deleting the stable execution graph. The pinned Undici build gains a
parse-time reason-phrase budget and distinct constant-error cleanup for status
100, upgrades, and other informational responses. Local stdio MCP servers are
explicitly classified as trusted same-UID operator code instead of being
incorrectly covered by the built-in file/shell boundary. Round 19 again requires
all three reports to contain zero new problems and zero correctness residuals.

### Round 19: open-ended and reverse audit, 2026-08-13

All three agents completed revision 19 review. The round was not clean:

- design/correctness: 2 new, 0 residual;
- S4/S5 archaeology: 3 new, 0 residual;
- provider/converter matrix: 1 new, 0 residual.

Revision 20 separates stable lexical path and physical-root authority through
two permanent broker lock-stripe pools, eliminating per-project lock deletion
and cleanup intents. PolicyUse adoption
is now an explicit, idempotent sidecar/project/chat-JSONL saga with canonical
owner keys and authoritative chat evidence. Managed HTTP fixes
`Accept-Encoding: identity`, rejects other content encodings, and enforces both
pre-Fetch physical `onData` and decoded-body caps. Round 20 again requires all
three reports to contain zero new problems and zero correctness residuals.

### Round 20: open-ended and reverse audit, 2026-08-13

All three agents completed revision 20 review. The round was not clean:

- design/correctness: 2 new, 0 residual;
- S4/S5 archaeology: 3 new, 0 residual;
- provider/converter matrix: 2 new, 0 residual.

Revision 21 freezes a platform-native workspace-slot ABI independent of logical
locator upgrades, including case and alias behavior, so lifecycle serialization
cannot split across equivalent paths. `PolicyUseRecord` is now a discriminated
pending/completed union, sidecar corruption has a bounded durable correction
state, and actual transcript removal is governed by an external crash-recoverable
conversation-delete intent. Managed HTTP makes `Connection: close` and
`Accept-Encoding: identity` mandatory in every closed operation profile, uses a
dedicated non-reused HTTP/1 connection, and enforces a pre-parser complete-
message cap in addition to transfer-decoded and decoded-body caps. Round 21 again
requires all three reports to contain zero new problems and zero correctness
residuals.

### Round 21: open-ended and reverse audit, 2026-08-13

All three agents completed revision 21 review. The round was not clean:

- design/correctness: 3 new, 1 residual;
- S4/S5 archaeology: 2 new, 0 residual;
- provider/converter matrix: 1 new, 0 residual.

Revision 22 moves persistence from per-PolicyUse adoption to one atomic delivery-
group adoption that owns raw/derived roots and every use, and derives pending
`useId` entirely from pre-execution identity. A cross-process conversation
lifecycle fence/generation now seals writers, adoption, archive, unarchive, and
deletion; the delete intent covers usage salvage, file-history, organization,
all transcript/sidecar targets, and has a no-v2 legacy branch. Workspace locking
uses a parent-inode-independent native lexical slot while actual removal is
retained-handle and identity bound, never mutable-path recursive delete. Physical
request validation is a discriminated operation union, so getPolicy query,
issued multipart credentials, source URL query, and inference Bearer placement
cannot contradict a nullable common validator. Round 22 again requires all
three reports to contain zero new problems and zero correctness residuals.

### Audit stopped at revision 27, 2026-08-14

The audit was stopped at the user's request. No audit agent remains active.
Round 27 was started against the frozen revision 27 document, but two audit
streams disconnected before producing final reports and no complete set of
three reports exists. Their partial progress is not counted as evidence, and
revision 27 must not be described as clean, approved, or implementation-ready.

The last valid common audit point remains Round 26:

- design/correctness: 3 new, 0 residual;
- S4/S5 archaeology: 3 new, 0 residual;
- provider/converter matrix: 0 new, 0 residual.

Revision 27 records the proposed corrections for the five merged Round 26
problem areas: conversation-root bootstrap and terminal cleanup, immutable
conversation mode selection independent of media sniffing, project-bound route
authorization, project/generation-bound transcript cursors, and physical
capacity/reservation for transcript, fork, and file-history bytes. These are
design changes, not independently verified resolutions.

One additional unresolved correctness question was found while consolidating
the stopped round. The transcript append failure path currently attempts to
persist `recordingState: 'recovery-required'` after an unexpected write, fsync,
or capacity-drift failure. A hard `ENOSPC` can also prevent that state write.
Before implementation, the protocol must make the already durable pre-write
reservation or an equivalent pre-write `appending` state the recovery authority,
so correctness never depends on a post-failure write. This item has not received
an independent three-agent review.
