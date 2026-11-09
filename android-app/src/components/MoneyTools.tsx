import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '@/src/lib/api';
import { theme } from '@/src/theme';

type Wallet = { id:string; name:string; currency:string; currentBalanceMinor:number; status:string; walletType:string };
type Category = { id:string; name:string; categoryType:'income'|'expense'; color:string };
type Budget = { id:string; categoryId:string; monthStart:string; limitMinor:number; carryForward:boolean };
type Recurring = { id:string; transactionType:'income'|'expense'; walletId:string; categoryId:string|null; description:string; amountMinor:number; frequency:'weekly'|'monthly'|'yearly'; nextRun:string; enabled:boolean };
type Reconciliation = { id:string; walletId:string; recordedMinor:number; actualMinor:number; varianceMinor:number; note:string|null; walletName?:string };
type Transaction = { transactionType:string; categoryId?:string|null; amountMinor:number; occurredAt:string };

const money=(minor:number)=>new Intl.NumberFormat('en-BD',{style:'currency',currency:'BDT',maximumFractionDigits:2}).format((Number(minor)||0)/100);
const dhakaMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7)+'-01';
const uuid=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16);});

export function MoneyTools({workspaceId,wallets,categories,budgets,recurring,reconciliations,transactions,getToken,onChanged}:{workspaceId:string;wallets:Wallet[];categories:Category[];budgets:Budget[];recurring:Recurring[];reconciliations:Reconciliation[];transactions:Transaction[];getToken:()=>Promise<string|null>;onChanged:()=>void}) {
  const [modal,setModal]=useState<'budget'|'recurring'|'reconcile'|null>(null);
  const [categoryId,setCategoryId]=useState('');
  const [limit,setLimit]=useState('');
  const [carryForward,setCarryForward]=useState(false);
  const [type,setType]=useState<'income'|'expense'>('expense');
  const [walletId,setWalletId]=useState('');
  const [description,setDescription]=useState('');
  const [amount,setAmount]=useState('');
  const [frequency,setFrequency]=useState<'weekly'|'monthly'|'yearly'>('monthly');
  const [nextRun,setNextRun]=useState(dhakaMonth());
  const [actualBalance,setActualBalance]=useState('');
  const [note,setNote]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  const currentBudgets=budgets.filter(row=>row.monthStart===dhakaMonth());
  const expenseCategories=categories.filter(row=>row.categoryType==='expense');
  const activeWallets=wallets.filter(row=>row.status==='active');

  async function submit() {
    setSaving(true);setError('');
    try {
      const token=await getToken();
      if(!token)throw new Error('An internet connection is required to manage Money Tools.');
      let body:Record<string,unknown>;
      if(modal==='budget'){
        if(!categoryId||!Number.isFinite(Number(limit))||Number(limit)<=0)throw new Error('Choose an expense category and enter a positive budget.');
        body={kind:'budget',categoryId,limitMinor:Math.round(Number(limit)*100),carryForward,monthStart:dhakaMonth()};
      }else if(modal==='recurring'){
        if(!walletId||!description.trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!/^\\d{4}-\\d{2}-\\d{2}$/.test(nextRun))throw new Error('Complete the recurring transaction details.');
        body={kind:'recurring',transactionType:type,walletId,categoryId:categoryId||null,description:description.trim(),amountMinor:Math.round(Number(amount)*100),frequency,nextRun};
      }else if(modal==='reconcile'){
        if(!walletId||!Number.isFinite(Number(actualBalance)))throw new Error('Choose a wallet and enter the actual balance.');
        body={kind:'reconciliation',walletId,actualMinor:Math.round(Number(actualBalance)*100),note:note||null};
      }else return;
      await apiRequest('/api/finance-tools',token,{method:'POST',workspaceId,body});
      setModal(null);setCategoryId('');setLimit('');setCarryForward(false);setDescription('');setAmount('');setActualBalance('');setNote('');
      onChanged();
    }catch(issue){setError(issue instanceof Error?issue.message:'Could not save this Money Tool.');}
    finally{setSaving(false);}
  }

  async function recurringAction(id:string,kind:'recurring-run'|'recurring-skip') {
    setSaving(true);setError('');
    try{
      const token=await getToken();if(!token)throw new Error('An internet connection is required.');
      await apiRequest('/api/finance-tools',token,{method:'POST',workspaceId,body:{kind,id}});
      onChanged();
    }catch(issue){setError(issue instanceof Error?issue.message:'Could not process recurring item.');}
    finally{setSaving(false);}
  }

  async function toggleRecurring(row:Recurring) {
    setSaving(true);setError('');
    try{
      const token=await getToken();if(!token)throw new Error('An internet connection is required.');
      await apiRequest('/api/finance-tools',token,{method:'PATCH',workspaceId,body:{id:row.id,enabled:!row.enabled}});
      onChanged();
    }catch(issue){setError(issue instanceof Error?issue.message:'Could not update recurring item.');}
    finally{setSaving(false);}
  }

  return <View style={styles.root}>
    <Text style={styles.title}>Money Tools</Text>
    <Text style={styles.subtitle}>Budgets, recurring transactions and wallet reconciliation.</Text>
    <View style={styles.actions}>
      <Pressable style={styles.primary} onPress={()=>{setModal('budget');setCategoryId('');setError('');}}><Text style={styles.primaryText}>+ Budget</Text></Pressable>
      <Pressable style={styles.primary} onPress={()=>{setModal('recurring');setWalletId('');setCategoryId('');setNextRun(dhakaMonth());setError('');}}><Text style={styles.primaryText}>+ Recurring</Text></Pressable>
      <Pressable style={styles.secondary} onPress={()=>{setModal('reconcile');setWalletId('');setError('');}}><Text style={styles.secondaryText}>Reconcile</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Monthly budgets</Text>
      {currentBudgets.map(row=>{const cat=categories.find(c=>c.id===row.categoryId);const spent=transactions.filter(t=>t.transactionType==='expense'&&t.categoryId===row.categoryId&&new Date(t.occurredAt)>=new Date(dhakaMonth())).reduce((sum,t)=>sum+Number(t.amountMinor),0);const percent=row.limitMinor>0?Math.min(100,spent/row.limitMinor*100):0;return <View key={row.id} style={styles.item}><View style={styles.row}><Text style={styles.itemTitle}>{cat?.name??'Budget'}</Text><Text style={styles.itemValue}>{money(spent)} / {money(row.limitMinor)}</Text></View><View style={styles.track}><View style={[styles.fill,{width:percent+'%'}]}/></View><Text style={styles.muted}>{Math.round(percent)}% used{row.carryForward?' · carry-forward enabled':''}</Text></View>;})}
      {!currentBudgets.length?<Text style={styles.muted}>No budgets set for this month.</Text>:null}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Recurring transactions</Text>
      {recurring.map(row=><View key={row.id} style={styles.item}>
        <View style={styles.row}><View style={{flex:1}}><Text style={styles.itemTitle}>{row.description}</Text><Text style={styles.muted}>{row.transactionType} · {row.frequency} · Next {row.nextRun}</Text></View><Text style={styles.itemValue}>{money(row.amountMinor)}</Text></View>
        <View style={styles.actions}>
          <Pressable style={styles.secondary} onPress={()=>void toggleRecurring(row)}><Text style={styles.secondaryText}>{row.enabled?'Pause':'Resume'}</Text></Pressable>
          {row.enabled?<><Pressable style={styles.secondary} onPress={()=>void recurringAction(row.id,'recurring-run')}><Text style={styles.secondaryText}>Run now</Text></Pressable><Pressable style={styles.secondary} onPress={()=>void recurringAction(row.id,'recurring-skip')}><Text style={styles.secondaryText}>Skip</Text></Pressable></>:null}
        </View>
      </View>)}
      {!recurring.length?<Text style={styles.muted}>No recurring transactions configured.</Text>:null}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Wallet reconciliations</Text>
      {reconciliations.slice(0,10).map(row=><View key={row.id} style={styles.item}><View style={styles.row}><Text style={styles.itemTitle}>{row.walletName??'Wallet'}</Text><Text style={styles.itemValue}>{money(row.varianceMinor)}</Text></View><Text style={styles.muted}>Recorded {money(row.recordedMinor)} · Actual {money(row.actualMinor)}{row.note?' · '+row.note:''}</Text></View>)}
      {!reconciliations.length?<Text style={styles.muted}>No reconciliation history yet.</Text>:null}
    </View>
    {!!error?<Text style={styles.error}>{error}</Text>:null}
    <Modal visible={!!modal} transparent animationType="slide" onRequestClose={()=>setModal(null)}>
      <View style={styles.backdrop}><View style={styles.modal}>
        <View style={styles.row}><Text style={styles.modalTitle}>{modal==='budget'?'Set monthly budget':modal==='recurring'?'New recurring transaction':'Reconcile wallet'}</Text><Pressable onPress={()=>setModal(null)}><Text style={styles.close}>✕</Text></Pressable></View>
        {modal==='budget'?<>
          <Text style={styles.label}>EXPENSE CATEGORY</Text><ScrollView horizontal>{expenseCategories.map(c=><Pressable key={c.id} onPress={()=>setCategoryId(c.id)} style={[styles.chip,categoryId===c.id&&styles.chipActive]}><Text style={styles.chipText}>{c.name}</Text></Pressable>)}</ScrollView>
          <Text style={styles.label}>MONTHLY LIMIT (৳)</Text><TextInput value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Pressable onPress={()=>setCarryForward(v=>!v)} style={styles.checkbox}><Text style={styles.checkboxText}>{carryForward?'☑':'□'} Carry unused budget forward</Text></Pressable>
        </>:null}
        {modal==='recurring'?<>
          <View style={styles.row}><Pressable onPress={()=>setType('expense')} style={[styles.chip,type==='expense'&&styles.chipActive]}><Text style={styles.chipText}>Expense</Text></Pressable><Pressable onPress={()=>setType('income')} style={[styles.chip,type==='income'&&styles.chipActive]}><Text style={styles.chipText}>Income</Text></Pressable></View>
          <Text style={styles.label}>DESCRIPTION</Text><TextInput value={description} onChangeText={setDescription} placeholder="e.g. Monthly rent" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.label}>AMOUNT (৳)</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.label}>WALLET</Text><ScrollView horizontal>{activeWallets.map(w=><Pressable key={w.id} onPress={()=>setWalletId(w.id)} style={[styles.chip,walletId===w.id&&styles.chipActive]}><Text style={styles.chipText}>{w.name}</Text></Pressable>)}</ScrollView>
          <Text style={styles.label}>CATEGORY</Text><ScrollView horizontal>{categories.filter(c=>c.categoryType===type).map(c=><Pressable key={c.id} onPress={()=>setCategoryId(c.id)} style={[styles.chip,categoryId===c.id&&styles.chipActive]}><Text style={styles.chipText}>{c.name}</Text></Pressable>)}</ScrollView>
          <Text style={styles.label}>FREQUENCY</Text><View style={styles.row}>{(['weekly','monthly','yearly'] as const).map(v=><Pressable key={v} onPress={()=>setFrequency(v)} style={[styles.chip,frequency===v&&styles.chipActive]}><Text style={styles.chipText}>{v}</Text></Pressable>)}</View>
          <Text style={styles.label}>FIRST RUN (YYYY-MM-DD)</Text><TextInput value={nextRun} onChangeText={setNextRun} placeholder="2026-12-01" placeholderTextColor={theme.colors.muted} style={styles.input}/>
        </>:null}
        {modal==='reconcile'?<>
          <Text style={styles.label}>WALLET</Text><ScrollView horizontal>{activeWallets.map(w=><Pressable key={w.id} onPress={()=>setWalletId(w.id)} style={[styles.chip,walletId===w.id&&styles.chipActive]}><Text style={styles.chipText}>{w.name}</Text></Pressable>)}</ScrollView>
          <Text style={styles.label}>ACTUAL BALANCE (৳)</Text><TextInput value={actualBalance} onChangeText={setActualBalance} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.muted} style={styles.input}/>
          <Text style={styles.label}>NOTE</Text><TextInput value={note} onChangeText={setNote} placeholder="Optional note" placeholderTextColor={theme.colors.muted} style={styles.input}/>
        </>:null}
        {!!error?<Text style={styles.error}>{error}</Text>:null}
        <Pressable disabled={saving} onPress={()=>void submit()} style={styles.submit}>{saving?<ActivityIndicator color="#fff"/>:<Text style={styles.submitText}>Save</Text>}</Pressable>
      </View></View>
    </Modal>
  </View>;
}

const styles=StyleSheet.create({
  root:{gap:12},title:{fontSize:22,fontWeight:'900',color:theme.colors.text},subtitle:{fontSize:11,color:theme.colors.muted,lineHeight:17},
  actions:{flexDirection:'row',gap:7,flexWrap:'wrap'},primary:{backgroundColor:theme.colors.greenDeep,paddingHorizontal:12,paddingVertical:10,borderRadius:10},primaryText:{color:'#fff',fontSize:10,fontWeight:'900'},
  secondary:{backgroundColor:theme.colors.surfaceSoft,borderWidth:1,borderColor:theme.colors.line,paddingHorizontal:11,paddingVertical:8,borderRadius:9},secondaryText:{color:theme.colors.text,fontSize:10,fontWeight:'800'},
  card:{backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.line,borderRadius:16,padding:14},cardTitle:{fontSize:14,fontWeight:'900',color:theme.colors.text,marginBottom:8},
  item:{paddingVertical:10,borderTopWidth:1,borderTopColor:theme.colors.line},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},itemTitle:{fontSize:11,fontWeight:'800',color:theme.colors.text,flex:1},itemValue:{fontSize:10,fontWeight:'900',color:theme.colors.text},muted:{fontSize:9,color:theme.colors.muted,marginTop:4,lineHeight:14},
  track:{height:6,borderRadius:20,backgroundColor:theme.colors.surfaceSoft,overflow:'hidden',marginTop:8},fill:{height:6,borderRadius:20,backgroundColor:theme.colors.green},error:{fontSize:10,color:theme.colors.danger,lineHeight:15},
  backdrop:{flex:1,backgroundColor:'#0008',justifyContent:'flex-end'},modal:{backgroundColor:theme.colors.background,borderTopLeftRadius:22,borderTopRightRadius:22,padding:18,paddingBottom:32,maxHeight:'92%'},modalTitle:{fontSize:18,fontWeight:'900',color:theme.colors.text},close:{fontSize:18,color:theme.colors.muted,padding:5},
  label:{fontSize:9,fontWeight:'900',color:theme.colors.text,marginTop:13,marginBottom:6},input:{borderWidth:1,borderColor:theme.colors.line,borderRadius:11,backgroundColor:theme.colors.surface,padding:11,color:theme.colors.text,fontSize:12,marginTop:6},
  chip:{paddingHorizontal:11,paddingVertical:8,borderRadius:10,borderWidth:1,borderColor:theme.colors.line,backgroundColor:theme.colors.surface,marginRight:6,marginTop:5},chipActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.greenSoft},chipText:{fontSize:9,color:theme.colors.text,fontWeight:'800'},
  checkbox:{paddingVertical:12},checkboxText:{fontSize:10,color:theme.colors.text,fontWeight:'700'},submit:{backgroundColor:theme.colors.greenDeep,padding:13,borderRadius:11,alignItems:'center',marginTop:16},submitText:{fontSize:11,color:'#fff',fontWeight:'900'},
});
