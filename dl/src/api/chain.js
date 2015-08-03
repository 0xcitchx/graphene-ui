import Immutable from "immutable";
import utils from "../common/utils"
import Apis from "../rpc_api/ApiInstances.js"
import {object_type} from "../chain/chain_types";

let op_history   = parseInt(object_type.operation_history, 10);
let limit_order  = parseInt(object_type.limit_order, 10);
let balance_type  = parseInt(object_type.balance, 10);
let vesting_balance_type  = parseInt(object_type.vesting_balance, 10);

let order_prefix = "1." + limit_order + "."
let balance_prefix = "1." + balance_type + "."
let vesting_balance_prefix = "1." + vesting_balance_type + "."


/**
 *  @brief maintains a local cache of blockchain state 
 *
 *  ChainStore is responsible for keeping track of objects,
 *  indexes, and subscriptions and completely abstracts away
 *  the websocket API exposed by the server.
 *
 *  All objects maintained by the ChainStore are kept Immutable to 
 *  facilitate easy change detection in the user interface.
 *
 *  It is undesirable to subscribe to all objects on the server; therefore,
 *  the ChainStore tracks the number of local subscribers to a particular object
 *  and automatically subscribes and unsubscribes from the remote object. It
 *  is important to manage this in a central place because the server only
 *  allows one callback per object.
 *
 *  When fetching data there are several possible states:
 *    1. The data is present, in which case it is simply returned
 *    2. The data is not present, in which case a query is made and a placeholder is
 *       returned indicating the loading state.
 *    3. The data is in the loading state, in which case it is simply returned.
 *    4. The data loading state returns an error, in which case the object state is changed
 *       from loading to error.
 *    5. The data is in the error state, in which case it is simply returned
 *    6. The data is 'stale' in which case a new query is made and a loading placeholder is returned
 *
 *  Every time an object is updated, the "last_update" property is set and every time an
 *  object is queried an optional freshness parameter may be passed which is compared against
 *  the last update property to determine staleness.  The last_update  property is maintained
 *  as part of the subscriptions structure and not the object itself to prevent the immutable
 *  object from being marked as dirty.
 */
class ChainStore 
{
   constructor() {
      this.objects_by_id            = Immutable.Map()
      this.accounts_by_name         = Immutable.Map()
      this.assets_by_id             = Immutable.Map()
      this.assets_by_symbol         = Immutable.Map()
      this.subscriptions_by_id      = new Map()
      this.subscriptions_by_account = new Map()
      this.subscriptions_by_market  = new Map()
   }

   /**
    *  Check for an account by name.  If it isn't known and no
    *  query has been issued in the last min_age seconds then
    *  submit a query to fetch the account name. Otherwise
    *  return the promise from the prior query
    *
    *  @return a Promise for the account value
    */
   getAccountByName( name, min_age_ms = null )
   {
      let acnt = this.accounts_by_name.get(name)
      if( acnt && id in acnt )
         return getObject( acnt.id, min_age_ms )

      let now = new Date().getTime()
      if( acnt && min_age_ms && acnt.last_query <= now - min_age_ms ) 
         acnt.last_query = now
      else if( !acnt )
         acnt = { last_query : now }

      if( acnt.last_query != now && last_promise in acnt )
         return acnt.last_promise

      /** make a websocket json-rpc call to get_account_by_name and pass it 
       * the name of the account that we are looking for.  If a valid account
       * is returned then add it to the global objects_by_id cache, update the
       * accounts_by_name index to point to the object id, then return the
       * account object
       */
      acnt.last_promise = new Promise( (resolve,reject ) => {
          Apis.instance().db_api().exec( "get_account_by_name", [ name ] )
              .then( optional_account_object => {
                  if( optional_account_object )
                  {
                     let new_obj = this._updateObject( optional_account_object )
                     acnt.id = new_obj.id
                     this.accounts_by_name.set( name, acnt )
                     resolve( new_obj )
                  }
                  else
                  {
                     reject( Error("Account " + name + " was not found" ) )
                  }
              }).catch( error => reject(error) )
      })
      return acnt.last_promise
   }


   unsubscribeFromAccount( account, on_update )
   {
      if( !account ) return

      let sub = this.subscriptions_by_account.get( id )
      sub.subscriptions.delete( on_update )
   }

   /**
    *  Fetches an account and all of its associated data in a single query
    *
    *  @param on_update, if not null then this account will be subscribed to
    *  and any time anything associated with this account changes, the
    *  method on_update will be called
    */
   getFullAccountById( id, on_update = null, min_age_ms = null )
   {
      let sub = this.subscriptions_by_account.get( id )

      let now = new Date().getTime()
      if( !sub )  sub = { last_query : now, subscriptions : new Set()  }
      if( on_update ) sub.subscriptions.add( on_update )

      if( sub.last_query < now - min_age_ms )
         sub.last_query = now

      let callback = change => this._updateAccount( id, change )

      if( sub.last_query == now ) {
         sub.last_promise = new Promise( (resolve,reject) => {
             Apis.instance().db_api().exec("get_full_accounts", 
                                           [callback,[id],sub.subscriptions.size > 0])
                 .then( results => {

                    let full_account = results[0][1]
                    console.log( "full account: ",  full_account )

                    let {
                        account, 
                        vesting_balances, 
                        statistics, 
                        call_orders, 
                        limit_orders, 
                        referrer_name, registrar_name, lifetime_referrer_name
                    } = full_account

                    this.accounts_by_name = this.accounts_by_name.set( account.name, account.id )

                    account.referrer_name = referrer_name
                    account.lifetime_referrer_name = lifetime_referrer_name
                    account.registrar_name = registrar_name
                    account.balances = {}
                    account.orders = new Immutable.Set()
                    account.vesting_balances = new Immutable.Set()
                    account.balances = new Immutable.Map()

                    for( var i = 0; i < vesting_balances.length; ++i )
                    {
                       this._updateObject( vesting_balances[i] )
                       account.vesting_balances = account.vesting_balances.add( vesting_balances[i].id )
                    }

                    for( var i = 0; i < full_account.balances.length; ++i )
                    {
                       let b = full_account.balances[i]
                       this._updateObject( b )
                       account.balances = account.balances.set( b.asset_type, full_account.balances[i].id )
                    }

                    this._updateObject( statistics )
                    let updated_account = this._updateObject( account )
                    resolve( updated_account )
                    this.getRecentHistory( updated_account )
                 }, error => reject( error ) )

         })
      }
      this.subscriptions_by_account.set( id, sub )
      return sub.last_promise
   }

   getAccountBalance( account, asset_type )
   {
      let balances = account.get( 'balances' )
      if( !balances ) 
         return 0

      let balance_obj_id = balances.get( asset_type )
      if( balance_obj_id )
      {
         let bal_obj = this.objects_by_id.get( balance_obj_id )
         console.log("balance obj", bal_obj )
         if( bal_obj ) return bal_obj.get( 'balance' )
      }
      return 0
   }

   /**
    * There are two ways to extend the account history, add new more
    * recent history, and extend historic hstory. This method will fetch
    * the most recent account history and prepend it to the list of
    * historic operations.
    *
    *  @param account immutable account object
    *  @return a promise with the account history 
    */
   getRecentHistory( account, limit = 100 )
   {
      /// TODO: make sure we do not submit a query if there is already one
      /// in flight...
        let account_id = account.get('id')
        let most_recent = "1." + op_history + ".0"
        let history = account.get( 'history' )

        if( history && history.size )  most_recent = history.first().get('id')

        if( history )
           console.log( 'first', history.first().toJS() )
        console.log( 'most recent:',most_recent )

        /// starting at 0 means start at NOW, set this to something other than 0
        /// to skip recent transactions and fetch the tail
        let start = "1." + op_history + ".0"

        console.log( "get_account_history: ", account_id, most_recent, limit, start)
        let prom = new Promise( (resolve, reject) => {
            Apis.instance().history_api().exec("get_account_history", 
                              [ account_id, most_recent, limit, start])
                .then( operations => {
                       console.log( "ops", operations )
                       let current_account = this.objects_by_id.get( account_id )
                       let current_history = current_account.get( 'history' )
                       if( !current_history ) current_history = Immutable.List()
                       let updated_history = Immutable.fromJS(operations);
                       updated_history = updated_history.withMutations( list => {
                              for( let i = 0; i < current_history.size; ++i )
                                  list.push( current_history.get(i) )
                                                      } )
                       let updated_account = current_account.set( 'history', updated_history )
                       this.objects_by_id = this.objects_by_id.set( account_id, updated_account )

                       if( current_history != updated_history )
                          this._notifyAccountSubscribers( account_id )

                       resolve(updated_account)
                       }) // end then
                     })
        return prom

   }

   _notifyAccountSubscribers( account_id )
   {
      let sub = this.subscriptions_by_account.get( account_id )
      let acnt = this.objects_by_id.get(account_id)
      if( !sub ) return
      for( let item of sub.subscriptions )
         item( acnt )
   }

   /**
    *  Callback that receives notification of objects that have been
    *  added, remove, or changed and are relevant to account_id
    *
    *  This method updates or removes objects from the main index and
    *  then updates the account object with relevant meta-info depending
    *  upon the type of account
    */
   _updateAccount( account_id, payload )
   {
      let updates = payload[0]
      let acnt = this.objects_by_id.get(account_id)

      for( let i = 0; i < updates.length; ++i )
      {
         let update = updates[i]
         if( typeof update  == 'string' )
         {
            let old_obj = this._removeObject( update )

            if( update.search( order_prefix ) == 0 )
            {
                  acnt = acnt.setIn( ['orders'], set => set.delete(update) )
            }
            else if( update.search( vesting_balance_prefix ) == 0 )
            {
                  acnt = acnt.setIn( ['vesting_balances'], set => set.delete(update) )
            }
         }
         else
         {
            let updated_obj = this._updateObject( update )

            if( update.id.search( balance_prefix ) == 0 )
            {
               if( update.owner == account_id )
                  acnt = acnt.setIn( ['balances'], map => map.set(update.asset_type,update.id) )
            }
            else if( update.id.search( order_prefix ) == 0 )
            {
               if( update.owner == account_id )
                  acnt = acnt.setIn( ['orders'], set => set.add(update.id) )
            }
            else if( update.id.search( vesting_balance_prefix ) == 0 )
            {
               if( update.owner == account_id )
                  acnt = acnt.setIn( ['vesting_balances'], set => set.add(update.id) )
            }

            this.objects_by_id = this.objects_by_id.set( acnt.id, acnt )
         }
      }
      this.getRecentHistory( acnt ) 
      this._notifyAccountSubscribers( account_id )
   }

   _removeObject( object_id )
   {
   }


   /**
    *  If the data is in the cache then the promise will resolve
    *  immediately.  Otherwise an asynchronous call will be made to
    *  fetch the object from the server.  
    *
    *  If we are not subscribed to the object, then min_age_ms will
    *  be used to determine if the object should be refreshed from 
    *  the server.
    *
    *  @return a promise with the object data
    */
   getObject( id, min_age_ms = null) {
      if( !utils.is_object_id(id) ) 
         throw Error( "argument is not an object id" )

      let current_sub = this.subscriptions_by_id.get(id)
      if( !current_sub )
         current_sub = { last_update: now }

      console.log( "current_sub: ", current_sub )

      let now = new Date().getTime()
      if( min_age_ms && current_sub.last_update <= now - min_age_ms )
         current_sub.last_update = now

      if( current_sub.last_update != now ) 
         return current_sub.last_promise
      
      current_sub.last_promise = new Promise( (resolve, reject ) => {
          Apis.instance().db_api().exec( "get_objects", [ id ] )
              .then( optional_objects => {
                  let result = optional_objects[0]
                  if( result )
                      resolve( this._updateObject( result ) )
                  else
                      reject( Error( "Unable to find object " + id ) )
              }).catch( error => reject(error) )
      })
      this.subscriptions_by_id.set( id, current_sub )
      return current_sub.last_promise
   }

   /**
    *  @return a promise to the current value of the object
    *  at the time of the subscription.  
    */
   subscribeToObject( id, subscriber, on_update )
   {
      let current_sub = this.subscriptions_by_id.get(id)

      if( !current_sub ) 
      {
         current_sub = { subscriptions : new Map() }
         this.subscriptions_by_id.set( id, current_sub )
      }

      if( !(subscriptions in current_sub ) )
         current_sub.subscriptions = new Map()
      let original_size = current_sub.subscriptions.size
      current_sub.subscriptions.set( subscriber, on_update )
      if( original_size == 0 )
      {
         /// TODO notify the backend that we would like to subscribe
         /// to updates on this object
      }

      return current_sub.last_promise
   }

   /**
    *  Remove the callback associated with the subscrier and
    *  unsubscribe from the remote server if the subscriber was 
    *  the last one listening
    */
   unsubscribeFromObject( id, subscriber )
   {
      let current_sub = this.subscriptions_by_id.get(id)
      if( !current_sub ) return
      if( !(subscriptions in current_sub) ) return

      if( current_sub.subscriptions.delete( subscriber ) )
      {
          if( current_sub.subscriptions.size == 0 )
          {
              // TODO: notify the backend that we would like to unsubscribe from
              // this particular object
          }
      }
   }

   getAssetBySymbol( name, min_age_ms = null )
   {
   }

   /**
    *  Updates the object in place by only merging the set
    *  properties of object.  
    *
    *  This method will create an immutable object with the given ID if
    *  it does not already exist.
    *
    *  This is a "private" method called when data is received from the
    *  server and should not be used by others.
    *
    *  @pre object.id must be a valid object ID
    *  @return an Immutable constructed from object and deep merged with the current state
    */
   _updateObject( object )
   {
      let current = this.objects_by_id.get( object.id )
      let by_id = this.objects_by_id
      if( !current )
         by_id = by_id.set( object.id, current = Immutable.fromJS(object) )
      else
         by_id = by_id.set( object.id, current = current.mergeDeep( Immutable.fromJS(object) ) )
      this.objects_by_id = by_id

      /** modify the current subscription state to indicate the last update time and
       * replace the last_promise with one that returns the latest object
       */
      let current_sub = this.subscriptions_by_id.get( object.id )
      if( !current_sub ) current_sub = {}

      current_sub.last_update = new Date().getTime()
      current_sub.last_promise = new Promise( (resolve,reject)=>resolve(current) )

      /// notify everyone who has subscribed to updates of this object
      if( 'subscriptions' in current_sub )
         for( sub of current_sub.subscriptions )
            sub( current )

      return current;
   }

   getGlobalProperties( min_age_ms = null )
   {
      /// TODO: replace "2.0.0" with constants defined from generated code
      return this.getObject( "2.0.0", min_age_ms )
   }

   getDynamicGlobalProperties( min_age = null )
   {
      /// TODO: replace "2.1.0" with constants defined from generated code
      return this.getObject( "2.1.0", min_age_ms )
   }

   removeObject( object_id )
   {
      this.objects_by_id.delete(object_id)
      /// TODO: notify backend that we no longer wish to subscribe to the
      /// given ID  (if we are currently subscribed)
      this.subscriptions_by_id.delete(object_id)
   }
}

export default new ChainStore();
