import { render } from 'preact';
import { App } from './App';
import { selectTransport } from './transport/select';
import './styles.css';

const transport = await selectTransport();
render(<App transport={transport} />, document.getElementById('root')!);
