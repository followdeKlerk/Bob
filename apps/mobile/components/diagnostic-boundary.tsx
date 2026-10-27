import React from 'react';
import {captureJsFault} from '../js-fault';
/** Observe a render failure, then rethrow the same error. No recovery UI or retries. */
export class DiagnosticBoundary extends React.Component<{children:React.ReactNode}> {
 componentDidCatch(error:Error){captureJsFault(error,'render');throw error;}
 render(){return this.props.children;}
}
