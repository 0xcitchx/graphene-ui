import React from "react";
import {PropTypes} from "react";
import {Link} from "react-router";
import Translate from "react-translate-component";
import BaseComponent from "../BaseComponent";
import ChainStore from "stores/ChainStore"

class Accounts2 extends BaseComponent {

    constructor() {
       super({account_name:"nathan"},ChainStore);
       /*
       this.state = {
         account : ChainStore.accounts_by_name.get("nathan") 
       }
       */

       if( ChainStore.accounts_by_name.has( "nathan" ) )
          ChainActions.getAccount( "nathan" )

       console.log( "Accounts2 constructor" )
    }

    shouldComponentUpdate(nextProps) {
        return true;
    }

    onChange(newState) {
       console.log( "changed" );
        if (newState) {
            console.log( "newState2" );
          //  this.setState( { account : ChainStore.accounts_by_name.get( this.props.account_name ) } );
          //  this.forceUpdate();
        }
    }

    render() {
       console.log( "Accounts2 render" );
        if( true ) //this.state.account )
           return (
               <div className="grid-block vertical">
                   <div className="grid-block page-layout">
                       <div className="grid-block medium-6 main-content">
                           <div className="grid-content">
                           { JSON.stringify( "moo"/*this.state.account*/, null, 2 ) }
                           </div>
                       </div>
                   </div>
               </div>
           );
        else
           return (
               <div className="grid-block vertical">
                   <div className="grid-block page-layout">
                       <div className="grid-block medium-6 main-content">
                           <div className="grid-content">
                           { JSON.stringify( "hello", null, 2 ) }
                           </div>
                       </div>
                   </div>
               </div>
           );
    }
}

Accounts2.defaultProps = {
    account: {}
};


export default Accounts2;
