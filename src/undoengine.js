/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

'use strict';

import Feature from '../feature.js';
import UndoCommand from './undocommand.js';

/**
 * Undo engine feature.
 *
 * Undo brings in possibility to undo and redo changes done in the model by deltas through
 * the {@link engine.model.Document#batch Batch API}.
 *
 * @memberOf undo
 * @extends ckeditor5.Feature
 */
export default class UndoEngine extends Feature {
	/**
	 * @inheritDoc
	 */
	constructor( editor ) {
		super( editor );

		/**
		 * Undo command which manages undo {@link engine.model.Batch batches} stack (history).
		 * Created and registered during {@link undo.UndoEngine#init feature initialization}.
		 *
		 * @private
		 * @member {undo.UndoEngineCommand} undo.UndoEngine#_undoCommand
		 */
		this._undoCommand = null;

		/**
		 * Undo command which manages redo {@link engine.model.Batch batches} stack (history).
		 * Created and registered during {@link undo.UndoEngine#init feature initialization}.
		 *
		 * @private
		 * @member {undo.UndoEngineCommand} undo.UndoEngine#_redoCommand
		 */
		this._redoCommand = null;
	}

	/**
	 * @inheritDoc
	 */
	init() {
		// Create commands.
		this._undoCommand = new UndoCommand( this.editor, 'undo' );
		this._redoCommand = new UndoCommand( this.editor, 'redo' );

		// Register command to the editor.
		this.editor.commands.set( 'redo', this._redoCommand );
		this.editor.commands.set( 'undo', this._undoCommand );

		this.listenTo( this.editor.document, 'change', ( evt, type, changes, batch ) => {
			// Whenever a new batch is created add it to the undo history and clear redo history.
			if ( batch.type === undefined ) {
				this._undoCommand.addBatch( batch );
				this._redoCommand.clearStack();
			} else if ( batch.type == 'undo' ) {
				this._redoCommand.addBatch( batch );
			} else if ( batch.type == 'redo' ) {
				this._undoCommand.addBatch( batch );
			}
		} );
	}
}
