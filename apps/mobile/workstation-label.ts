export type Workstation={backendId:string;name:string;alias?:string};
export const WORKSTATION_ALIAS_LIMIT=24;
/** Local display metadata only: never replace endpoint, pairing UUID or credentials. */
export function cleanWorkstationAlias(value:string){
 const alias=value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 if(Array.from(alias).length>WORKSTATION_ALIAS_LIMIT)throw Error('Use an alias of 24 characters or fewer.');
 return alias;
}
export function workstationLabel(workstation:Workstation,all:readonly Workstation[]=[]){
 const base=(item:Workstation)=>{
  try{return cleanWorkstationAlias(item.alias??'')||Array.from(item.name.split('.')[0].trim()||'Workstation').slice(0,WORKSTATION_ALIAS_LIMIT).join('');}
  catch{return 'Workstation';}
 };
 const label=base(workstation);
 return all.some(item=>item.backendId!==workstation.backendId&&base(item).toLocaleLowerCase()===label.toLocaleLowerCase())?`${label} · ${workstation.backendId.slice(0,4)}`:label;
}
