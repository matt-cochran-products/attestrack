/** Role-separated operation protocol. No store, credentials, provider or activation. */
import { canonical, type Journal, type Operation } from './native-application-release.ts';
import { digest, REPOSITORY } from './application-artifacts.ts';
const HASH=/^[a-f0-9]{64}$/, SHA=/^[a-f0-9]{40}$/, UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function closed(x:unknown,keys:string[]):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join()!==keys.sort().join())throw Error('Invalid operation record');return x as Record<string,unknown>;}
function positive(x:unknown){if(typeof x!=='number'||!Number.isSafeInteger(x)||x<1)throw Error('Invalid native execution identity');}
function hash(x:unknown){if(typeof x!=='string'||!HASH.test(x))throw Error('Invalid operation binding');}
export interface Executor { repository_id:number; workflow_commit:string; run_id:number; run_attempt:number; job_id:number }
export interface Frame { schema:'attestrack.native-operation-frame/v1'; repository:typeof REPOSITORY; environment:'staging'|'production'; state:'prepared'|'execution-claimed'|'unknown'|'acknowledged'; journal:Journal; executor:Executor|null; acknowledgement:Acknowledgement|null }
export interface Acknowledgement { schema:'attestrack.native-operation-ack/v1'; journal_sha256:string; operation_id:string; name:Operation['name']; native_id:string; after:Journal['after'] }
function executor(value:unknown):Executor{const o=closed(value,['repository_id','workflow_commit','run_id','run_attempt','job_id']);for(const n of ['repository_id','run_id','run_attempt','job_id'])positive(o[n]);if(typeof o.workflow_commit!=='string'||!SHA.test(o.workflow_commit))throw Error('Invalid executor source');return o as unknown as Executor;}
export function validateJournal(value:unknown):Journal{
 const j=closed(value,['schema','operation_id','artifact','target_sha256','tool_profile_sha256','predecessor','operations','after']);
 if(j.schema!=='attestrack.native-write-journal/v1'||typeof j.operation_id!=='string'||!UUID.test(j.operation_id))throw Error('Invalid operation identity');
 hash(j.target_sha256);hash(j.tool_profile_sha256);const a=closed(j.artifact,['artifact_id','producer_run','producer_attempt','archive_sha256','inventory_sha256','source_tree']);for(const k of ['artifact_id','producer_run','producer_attempt'])positive(a[k]);for(const k of ['archive_sha256','inventory_sha256'])hash(a[k]);if(typeof a.source_tree!=='string'||!SHA.test(a.source_tree))throw Error('Invalid artifact tree');
 snapshot(j.predecessor);if(j.after!==null)snapshot(j.after);
 const order=['worker-upload','worker-switch','pages-assets','pages-deploy'];if(!Array.isArray(j.operations)||j.operations.length<1||j.operations.length>4)throw Error('Invalid operation sequence');
 const operations=j.operations;operations.forEach((x,i)=>{const o=closed(x,['name','state','native_id']);if(o.name!==order[i]||!['unknown','confirmed'].includes(o.state as string))throw Error('Invalid operation sequence');if(o.state==='unknown'){if(i!==operations.length-1||o.native_id!==null)throw Error('Unknown operation cannot advance');}else if(typeof o.native_id!=='string'||(o.name==='pages-assets'?!HASH.test(o.native_id):!UUID.test(o.native_id)))throw Error('Invalid native acknowledgement');});
 const switched=j.operations.length>=2&&j.operations[1].state==='confirmed';
 if((j.after!==null)!==switched)throw Error('Confirmed switch requires exact native readback');
 if(switched){const w=(j.after as Journal['predecessor']).worker;if(w.version_id!==j.operations[0].native_id||w.deployment_id!==j.operations[1].native_id||w.operation_id!==j.operation_id||w.deployment_operation_id!==j.operation_id)throw Error('Native serving acknowledgement differs');}
 return structuredClone(value) as Journal;
}
function snapshot(raw:unknown){const s=closed(raw,['worker','pages']),w=closed(s.worker,['deployment_id','version_id','latest_version_id','configuration_sha256','version_configuration_sha256','module_sha256','operation_id','deployment_operation_id']);for(const k of ['deployment_id','version_id','latest_version_id'])if(typeof w[k]!=='string'||!UUID.test(w[k] as string))throw Error('Invalid Worker readback');for(const k of ['configuration_sha256','version_configuration_sha256','module_sha256'])hash(w[k]);for(const k of ['operation_id','deployment_operation_id'])if(w[k]!==null&&(typeof w[k]!=='string'||!UUID.test(w[k] as string)))throw Error('Invalid operation readback');if(s.pages!==null){const p=closed(s.pages,['deployment_id','configuration_sha256','operation_id']);if(typeof p.deployment_id!=='string'||!UUID.test(p.deployment_id))throw Error('Invalid Pages readback');hash(p.configuration_sha256);if(p.operation_id!==null&&(typeof p.operation_id!=='string'||!UUID.test(p.operation_id)))throw Error('Invalid Pages operation');}}
export function prepareOperation(journal:Journal,environment:Frame['environment']):Frame{const j=validateJournal(journal);if(!['staging','production'].includes(environment)||j.operations.at(-1)!.state!=='unknown')throw Error('Prepared unknown operation required');return{schema:'attestrack.native-operation-frame/v1',repository:REPOSITORY,environment,state:'prepared',journal:j,executor:null,acknowledgement:null};}
function frame(raw:unknown):Frame{const f=closed(raw,['schema','repository','environment','state','journal','executor','acknowledgement']);if(f.schema!=='attestrack.native-operation-frame/v1'||f.repository!==REPOSITORY||!['staging','production'].includes(f.environment as string)||!['prepared','execution-claimed','unknown','acknowledged'].includes(f.state as string))throw Error('Invalid operation frame');validateJournal(f.journal);if(f.executor!==null)executor(f.executor);if(f.state==='prepared'?(f.executor!==null||f.acknowledgement!==null):(f.executor===null))throw Error('Invalid execution claim');if(f.state!=='acknowledged'&&f.acknowledgement!==null)throw Error('Unexpected acknowledgement');return structuredClone(raw) as Frame;}
/** Journal role must CAS-persist this transition before the provider job starts. */
export function claimOperation(raw:Frame,owner:Executor):Frame{const f=frame(raw);if(f.state!=='prepared')throw Error('Existing claim or unknown operation requires read-only reconciliation');return{...f,state:'execution-claimed',executor:executor(owner)};}
/** Any lost acknowledgement/dead executor remains unknown; no claim reset. */
export function unknownOperation(raw:Frame):Frame{const f=frame(raw);if(f.state!=='execution-claimed')throw Error('No active execution claim');return{...f,state:'unknown'};}
export interface AuthenticatedJournalReader { readCurrent(context:{repository:typeof REPOSITORY;environment:Frame['environment'];operation_id:string}):Promise<unknown> }
export interface Execution { readonly operation_id:string }
const capabilities=new WeakMap<Execution,Frame>();
const issuedClaims=new Set<string>();
/** The fixed journal role reader authenticates+decrypts CURRENT durable bytes.
 * No plaintext reader or codec default exists. Assembly must authenticate its
 * own executor metadata; this library does not infer that from caller JSON. */
export async function execution(reader:AuthenticatedJournalReader,context:{environment:Frame['environment'];operation_id:string},own:Executor):Promise<Execution>{
 if(!reader||typeof reader.readCurrent!=='function')throw Error('Authenticated encrypted journal reader required');
 const f=frame(await reader.readCurrent({repository:REPOSITORY,...context}));
 if(f.state!=='execution-claimed'||f.environment!==context.environment||f.journal.operation_id!==context.operation_id||canonical(f.executor)!==canonical(executor(own)))throw Error('Durable execution claim differs; reconcile without replay');
 const key=digest(canonical({executor:f.executor,operation_id:f.journal.operation_id,journal:f.journal}));if(issuedClaims.has(key))throw Error('Execution claim already issued; reconcile without replay');issuedClaims.add(key);
 const cap=Object.freeze({operation_id:f.journal.operation_id});capabilities.set(cap,f);return cap;
}
/** Process-local consumption is defense in depth, NOT durable exactly-once. */
export function consumeExecution(cap:Execution):Frame{const f=capabilities.get(cap);if(!f)throw Error('Original durable execution capability required');capabilities.delete(cap);return structuredClone(f);}
/** Journal role authenticates original executor ACK artifact BEFORE this CAS. */
export function recordAcknowledgement(raw:Frame,rawAck:Acknowledgement):Frame{const f=frame(raw),a=closed(rawAck,['schema','journal_sha256','operation_id','name','native_id','after']);const last=f.journal.operations.at(-1)!;
 if(f.state!=='execution-claimed'||a.schema!=='attestrack.native-operation-ack/v1'||a.journal_sha256!==digest(canonical(f.journal))||a.operation_id!==f.journal.operation_id||a.name!==last.name)throw Error('Acknowledgement differs from durable claim');
 const j=structuredClone(f.journal);j.operations.at(-1)!.state='confirmed';j.operations.at(-1)!.native_id=a.native_id as string;j.after=a.after as Journal['after'];validateJournal(j);return{...f,state:'acknowledged',journal:j,acknowledgement:structuredClone(rawAck)};
}
