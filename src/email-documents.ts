import {defineDoc,defineDocFamily} from '@earendil-works/pi-durable';
export const DEFAULT_EMAIL_MAILBOXES=['Inbox','Spam','Archive'] as const;
export type MailEnvelope={id:string;messageId:string;inReplyTo?:string[];subject:string;from:{name:string|null;email:string}[];date:string;flags:string[]};
export type MailSearch={mailbox:string;nextPage:number;complete:boolean;pending:boolean};
/** Only metadata is copied here. Mail content already belongs to native tool receipts, not this index. */
export const EmailReads=defineDoc<{listed:boolean;failed:boolean;calls:number;searches:Record<string,MailSearch>;candidates:Record<string,MailEnvelope>;reads:Record<string,{mailbox:string;id:string;messageId:string}>}>({kind:'bob.email-reads',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({listed:false,failed:false,calls:0,searches:{},candidates:{},reads:{}}),checkpointWhen:()=>true});
/** IDs enter this ledger only in the same native commit that saves their source-chat alert. */
export const EmailDelivered=defineDocFamily<{keys:string[]},null>({kind:'bob.email-delivered',version:1,scope:'session',family:true,initial:()=>({keys:[]}),checkpointWhen:()=>true});
