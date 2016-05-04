/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

'use strict';

import Command from '../command/command.js';

/**
 * Undo command stores batches in itself and is able to and apply reverted versions of them on the document.
 *
 * undo.UndoCommand
 */
export default class UndoCommand extends Command {
	/**
	 * @see engine.command.Command
	 * @param {engine.Editor} editor
	 */
	constructor( editor ) {
		super( editor );

		/**
		 * Batches which are saved by the command. They can be reversed.
		 *
		 * @private
		 * @member {Array.<engine.treeModel.Batch>} undo.UndoCommand#_batchStack
		 */
		this._batchStack = [];

		/**
		 * Stores the selection ranges for each batch and use them to recreate selection after undo.
		 *
		 * @private
		 * @member {WeakMap.<engine.treeModel.Range>} undo.UndoCommand#_batchSelection
		 */
		this._batchSelection = new WeakMap();
	}

	/**
	 * Stores a batch in the command. Stored batches can be then reverted.
	 *
	 * @param {engine.treeModel.Batch} batch Batch to add.
	 * @param {Array.<engine.treeModel.Range>} selectionRanges All ranges that were in the selection when batch got
	 * created.
	 */
	addBatch( batch ) {
		this._batchStack.push( batch );
		this._batchSelection.set( batch, Array.from( this.editor.document.selection.getRanges() ) );
	}

	/**
	 * Removes all batches from the stack.
	 */
	clearStack() {
		this._batchStack = [];
		this._batchSelection.clear();
	}

	/**
	 * Checks whether this command should be enabled. Command is enabled when it has any batches in its stack.
	 *
	 * @private
	 * @returns {Boolean}
	 */
	_checkEnabled() {
		return this._batchStack.length > 0;
	}

	/**
	 * Executes the command: reverts a {@link engine.treeModel.Batch batch} added to the command's stack,
	 * applies it on the document and removes the batch from the stack.
	 *
	 * Fires `undo` event with reverted batch as a parameter.
	 *
	 * @private
	 * @param {Number} [batchIndex] If set, batch under the given index on the stack will be reverted and removed.
	 * If not set, or invalid, the last added batch will be reverted and removed.
	 */
	_doExecute( batchIndex ) {
		batchIndex = this._batchStack[ batchIndex ] ? batchIndex : this._batchStack.length - 1;

		// Get the batch to undo.
		const undoBatch = this._batchStack.splice( batchIndex, 1 )[ 0 ];
		const undoDeltas = undoBatch.deltas.slice();
		// Deltas have to be applied in reverse order, so if batch did A B C, it has to do reversed C, reversed B, reversed A.
		undoDeltas.reverse();

		// Reverse the deltas from the batch, transform them, apply them.
		for ( let undoDelta of undoDeltas ) {
			const undoDeltaReversed = undoDelta.getReversed();
			const updatedDeltas = this.editor.document.history.getTransformedDelta( undoDeltaReversed );

			for ( let delta of updatedDeltas ) {
				for ( let operation of delta.operations ) {
					this.editor.document.applyOperation( operation );
				}
			}
		}

		// Take all selection ranges that were stored with undone batch.
		const ranges = this._batchSelection.get( undoBatch );

		// The ranges will be transformed by deltas from history that took place
		// after the selection got stored.
		const deltas = this.editor.document.history.getDeltas( undoBatch.deltas[ 0 ].baseVersion ) || [];

		// This will keep the transformed ranges.
		const transformedRanges = [];

		for ( let originalRange of ranges ) {
			// We create `transformed` array. At the beginning it will have only the original range.
			// During transformation the original range will change or even break into smaller ranges.
			// After the range is broken into two ranges, we have to transform both of those ranges separately.
			// For that reason, we keep all transformed ranges in one array and operate on it.
			let transformed = [ originalRange ];

			for ( let delta of deltas ) {
				for ( let operation of delta.operations ) {
					// We look through all operations from all deltas.

					for ( let t = 0; t < transformed.length; t++ ) {
						// We transform every range by every operation.
						// We keep current state of transformation in `transformed` array and update it.
						let result;

						switch ( operation.type ) {
							case 'insert':
								result = transformed[ t ].getTransformedByInsertion( operation.position, operation.nodeList.length, true );
								break;

							case 'move':
							case 'remove':
							case 'reinsert':
								result = transformed[ t ].getTransformedByMove( operation.sourcePosition, operation.targetPosition, operation.howMany, true );
								break;
						}

						// If we have a transformation result, we substitute it in `transformed` array with
						// the range that got transformed. Keep in mind that the result is an array
						// and may contain multiple ranges.
						if ( result ) {
							transformed.splice( t, 1, ...result );

							// Fix iterator.
							t = t + result.length - 1;
						}
					}
				}
			}

			// After `originalRange` got transformed, we have an array of ranges. Some of those
			// ranges may be "touching" -- they can be next to each other and could be merged.
			// Let's do this. First, we have to sort those ranges because they don't have to be
			// in an order.
			transformed.sort( ( a, b ) => a.start.isBefore( b.start ) ? -1 : 1 );

			// Then we check if two consecutive ranges are touching. We can do it pair by pair
			// in one dimensional loop because ranges are sorted.
			for ( let i = 1 ; i < transformed.length; i++ ) {
				let a = transformed[ i - 1 ];
				let b = transformed[ i ];

				if ( a.end.isTouching( b.start ) ) {
					a.end = b.end;
					transformed.splice( i, 1 );
					i--;
				}
			}

			// For each `originalRange` from `ranges`, we take only one transformed range.
			// This is because we want to prevent situation where single-range selection
			// got transformed to mulit-range selection. We will take the first range that
			// is not in the graveyard.
			const transformedRange = transformed.find(
				( range ) => range.start.root != this.editor.document.graveyard
			);

			if ( transformedRange ) {
				transformedRanges.push( transformedRange );
			}
		}

		// `transformedRanges` may be empty if all ranges ended up in graveyard.
		// If that is the case, do not restore selection.
		if ( transformedRanges.length ) {
			this.editor.document.selection.setRanges( transformedRanges );
		}

		this.fire( 'undo', undoBatch );
	}
}
